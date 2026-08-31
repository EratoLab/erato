import { i18n, type Messages } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStartingAssistant } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { messages as enMessages } from "@/locales/en/messages.json";

import HomePage from "../HomePage";

import "@testing-library/jest-dom";

i18n.load("en", enMessages as unknown as Messages);
i18n.activate("en");

const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  )),
  useNavigate: () => mockNavigate,
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useStartingAssistant: vi.fn(),
}));

const mockStartingAssistant = (
  value: Partial<ReturnType<typeof useStartingAssistant>>,
) => {
  vi.mocked(useStartingAssistant).mockReturnValue({
    data: undefined,
    error: null,
    isLoading: false,
    ...value,
  } as ReturnType<typeof useStartingAssistant>);
};

const renderPage = (initialEntry = "/?utm=welcome") =>
  render(
    <I18nProvider i18n={i18n}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <HomePage />
      </MemoryRouter>
    </I18nProvider>,
  );

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("redirects to the resolved starting assistant, preserving the query string", () => {
    mockStartingAssistant({
      data: {
        starting_assistant: {
          assistant_id: "assistant-123",
          assistant_hub_assistant_id: "hub-456",
          source: "audience_pin",
          audience: "pilot",
        },
      },
    });

    renderPage();

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/a/assistant-123?utm=welcome", {
      replace: true,
    });
  });

  it("redirects to the welcome screen when no starting assistant applies", () => {
    // An absent field is the decided "welcome screen" answer (covers never
    // set, explicitly cleared, and every degraded resolution).
    mockStartingAssistant({ data: {} });

    renderPage();

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/chat/new?utm=welcome", {
      replace: true,
    });
  });

  it("falls back to the welcome screen when the request fails", () => {
    mockStartingAssistant({
      error: { status: 500, payload: "boom" } as unknown as ReturnType<
        typeof useStartingAssistant
      >["error"],
    });

    renderPage();

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/chat/new?utm=welcome", {
      replace: true,
    });
  });

  it("falls back to the welcome screen when resolution is slow, and never navigates twice", () => {
    vi.useFakeTimers();
    mockStartingAssistant({ isLoading: true });

    const { rerender } = renderPage();

    // Still waiting inside the timeout budget: no navigation yet.
    expect(mockNavigate).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/chat/new?utm=welcome", {
      replace: true,
    });

    // A late-resolving query must not trigger a second navigation.
    mockStartingAssistant({
      data: {
        starting_assistant: {
          assistant_id: "assistant-123",
          assistant_hub_assistant_id: "hub-456",
          source: "user_pick",
        },
      },
    });
    rerender(
      <I18nProvider i18n={i18n}>
        <MemoryRouter initialEntries={["/?utm=welcome"]}>
          <HomePage />
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });
});
