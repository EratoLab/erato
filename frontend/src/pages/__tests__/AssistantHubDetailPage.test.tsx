import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useToastStore } from "@/components/ui/Toast/toastStore";

import AssistantHubDetailPage from "../AssistantHubDetailPage";

const version = {
  assistant: { id: "hub-clone", name: "Release notes helper" },
  assistant_id: "hub-clone",
  diff_summary: {},
  hub_assistant_id: "hub-1",
  review_average_score: null,
  review_count: 0,
  version_comment: null,
  version_number: "1.0.0",
};

const submitReview = vi.fn();

vi.mock("@/hooks/ui", () => ({
  usePageAlignment: () => ({
    containerClasses: "container",
    horizontalPadding: "px-4",
  }),
}));

vi.mock("@/components/ui/Feedback/Alert", () => ({
  Alert: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));

vi.mock("../assistantHubUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../assistantHubUtils")>()),
  AssistantHubVersionOverviewSection: () => null,
  AssistantHubVersionConfigurationSection: () => null,
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useAssistantHubConfig: () => ({ data: { enabled: true, categories: [] } }),
  useGetAssistantHubAssistant: () => ({
    data: { version },
    isLoading: false,
    error: null,
  }),
  useGetAssistant: () => ({ data: undefined }),
  useProfile: () => ({ data: { id: "me" } }),
  useListAssistantHubReviews: () => ({
    data: { reviews: [] },
    isLoading: false,
  }),
  useSubmitAssistantHubReview: () => useMutation({ mutationFn: submitReview }),
  assistantHubConfigQuery: () => ({
    queryKey: ["api", "v1beta", "assistant-hub", "config"],
  }),
}));

function renderPage(queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/assistant-hub/hub-1"]}>
        <Routes>
          <Route
            path="/assistant-hub/:hubAssistantId"
            element={<AssistantHubDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const settle = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

describe("AssistantHubDetailPage", () => {
  beforeEach(() => {
    submitReview.mockReset();
    submitReview.mockResolvedValue({});
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the review busy until the hub views have refetched, then confirms it", async () => {
    const queryClient = new QueryClient();
    let finishRefetch!: () => void;
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockReturnValue(
        new Promise<void>((resolve) => {
          finishRefetch = resolve;
        }),
      );

    renderPage(queryClient);

    const submit = screen.getByRole("button", { name: "Submit review" });
    fireEvent.click(submit);
    await settle();
    fireEvent.click(submit);
    await settle();

    expect(submitReview).toHaveBeenCalledTimes(1);
    expect(submit).toHaveAttribute("aria-busy", "true");
    expect(invalidateQueries.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: ["api", "v1beta", "assistant-hub"] },
    ]);
    expect(useToastStore.getState().toasts).toEqual([]);

    await act(async () => {
      finishRefetch();
      await Promise.resolve();
    });

    expect(submit).not.toHaveAttribute("aria-busy");
    expect(useToastStore.getState().toasts).toMatchObject([
      { variant: "success", title: "Review saved." },
    ]);
  });
});
