import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FrequentAssistantsList } from "../FrequentAssistantsList";

const mockUseFrequentAssistants = vi.fn();

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useFrequentAssistants: (args: unknown) => mockUseFrequentAssistants(args),
}));

describe("FrequentAssistantsList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render divider when there are no recent assistants", () => {
    mockUseFrequentAssistants.mockReturnValue({
      data: { assistants: [] },
      isLoading: false,
      error: null,
    });

    const { container } = render(
      <MemoryRouter>
        <FrequentAssistantsList limit={5} showBottomDivider={true} />
      </MemoryRouter>,
    );

    expect(
      container.querySelectorAll(".border-t.border-theme-border"),
    ).toHaveLength(0);
  });

  it("renders assistants and bottom divider when content is present", () => {
    mockUseFrequentAssistants.mockReturnValue({
      data: {
        assistants: [{ id: "assistant-1", name: "Assistant Alpha" }],
      },
      isLoading: false,
      error: null,
    });

    const { container } = render(
      <MemoryRouter>
        <FrequentAssistantsList limit={5} showBottomDivider={true} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Assistant Alpha")).toBeInTheDocument();
    expect(
      container.querySelectorAll(".border-t.border-theme-border"),
    ).toHaveLength(1);
  });
});
