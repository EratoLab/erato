import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import AssistantHubSubmitPage from "../AssistantHubSubmitPage";

import type { Messages } from "@lingui/core";

const hubConfig = {
  enabled: true,
  enable_categories: true,
  default_share_with_whole_organization: false,
  categories: [
    { id: "productivity", display_name: "Productivity" },
    { id: "research", display_name: "Research" },
  ],
};

const assistant = {
  id: "assistant-1",
  name: "Release notes helper",
  description: "Turns changelogs into release notes",
};

const submitVersion = vi.fn();

vi.mock("@/hooks/ui", () => ({
  usePageAlignment: () => ({
    containerClasses: "container",
    horizontalPadding: "px-4",
  }),
}));

vi.mock("@/components/ui/Sharing/SubjectSelector", () => ({
  SubjectSelector: () => <div data-testid="subject-selector" />,
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useAssistantHubConfig: () => ({ data: hubConfig, isLoading: false }),
  useGetAssistant: () => ({ data: assistant, isLoading: false, error: null }),
  useListMyAssistantHubVersions: () => ({
    data: { versions: [] },
    isLoading: false,
  }),
  useListShareGrants: () => ({ data: undefined, isLoading: false }),
  usePreviewAssistantHubSubmissionDiff: () => ({
    mutateAsync: vi.fn(),
    error: null,
    data: undefined,
    isPending: false,
  }),
  useSubmitAssistantHubVersion: () => ({
    mutateAsync: submitVersion,
    error: null,
    isPending: false,
  }),
  useAvailableModels: () => ({ data: undefined }),
  useFacets: () => ({ data: undefined }),
}));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/assistant-hub/submit/assistant-1"]}>
        <I18nProvider i18n={i18n}>
          <Routes>
            <Route
              path="/assistant-hub/submit/:sourceAssistantId"
              element={<AssistantHubSubmitPage />}
            />
          </Routes>
        </I18nProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AssistantHubSubmitPage", () => {
  beforeEach(() => {
    submitVersion.mockClear();
    submitVersion.mockResolvedValue(undefined);
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  it("announces the hub category choice on the chip itself", () => {
    renderPage();

    const productivity = screen.getByRole("button", { name: "Productivity" });
    const research = screen.getByRole("button", { name: "Research" });

    expect(productivity).toHaveAttribute("aria-pressed", "false");
    expect(productivity).not.toHaveAttribute("data-selected");

    fireEvent.click(productivity);

    expect(productivity).toHaveAttribute("aria-pressed", "true");
    expect(productivity).toHaveAttribute("data-selected");
    expect(research).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(productivity);

    expect(productivity).toHaveAttribute("aria-pressed", "false");
    expect(productivity).not.toHaveAttribute("data-selected");
  });

  it("submits the categories the chips collected", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Research" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit version" }));

    await waitFor(() => expect(submitVersion).toHaveBeenCalledTimes(1));
    expect(submitVersion.mock.calls[0][0].body.category_ids).toEqual([
      "research",
    ]);
  });
});
