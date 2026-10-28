import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useToastStore } from "@/components/ui/Toast/toastStore";

import AssistantHubReviewPage from "../AssistantHubReviewPage";

import type { AssistantHubVersion } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const makeVersion = (
  versionId: string,
  overrides: Partial<AssistantHubVersion> = {},
): AssistantHubVersion => ({
  assistant: {
    created_at: "2026-01-01T00:00:00Z",
    description: "Assistant description",
    enforce_facet_settings: false,
    id: `${versionId}-assistant`,
    name: `Assistant ${versionId}`,
    prompt: "Assistant prompt",
    updated_at: "2026-01-02T00:00:00Z",
  },
  assistant_id: `${versionId}-assistant`,
  audience_grants: [],
  category_ids: [],
  created_at: "2026-01-01T00:00:00Z",
  creator: { display_name: "Assistant creator", id: "creator" },
  diff_summary: {},
  featured: false,
  hub_assistant_id: `${versionId}-hub`,
  is_current_published_version: false,
  is_published: false,
  keywords: [],
  long_description: "Long assistant description",
  review_average_score: null,
  review_count: 0,
  source_assistant_id: `${versionId}-source`,
  status: "review_accepted",
  submitted_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  version_id: versionId,
  version_number: "1.0.0",
  ...overrides,
});

let versions: AssistantHubVersion[];
const reviewVersion = vi.fn();
const setPublished = vi.fn();
const setCurrent = vi.fn();
const setFeatured = vi.fn();

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

vi.mock("@/components/ui/Sharing/ShareGrantsList", () => ({
  ShareGrantsList: () => null,
}));

vi.mock("../assistantHubUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../assistantHubUtils")>()),
  AssistantHubVersionOverviewSection: () => null,
  AssistantHubVersionConfigurationSection: () => null,
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useAssistantHubConfig: () => ({
    data: {
      enabled: true,
      can_review: true,
      enable_categories: false,
      categories: [],
    },
    isLoading: false,
  }),
  useListReviewAssistantHubVersions: () => ({
    data: { versions },
    isLoading: false,
    error: null,
  }),
  useGetAssistant: () => ({ data: undefined }),
  useReviewAssistantHubVersion: () =>
    useMutation({ mutationFn: reviewVersion }),
  useSetAssistantHubVersionPublished: () =>
    useMutation({ mutationFn: setPublished }),
  useSetAssistantHubVersionCurrent: () =>
    useMutation({ mutationFn: setCurrent }),
  useSetAssistantHubVersionFeatured: () =>
    useMutation({ mutationFn: setFeatured }),
  assistantHubConfigQuery: () => ({
    queryKey: ["api", "v1beta", "assistant-hub", "config"],
  }),
  startingAssistantQuery: () => ({
    queryKey: ["api", "v1beta", "me", "starting-assistant"],
  }),
  getAssistantQuery: ({
    pathParams,
  }: {
    pathParams: { assistantId: string };
  }) => ({ queryKey: ["api", "v1beta", "assistants", pathParams.assistantId] }),
}));

function renderPage(path: string, queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/assistant-hub/review"
            element={<AssistantHubReviewPage />}
          />
          <Route
            path="/assistant-hub/review/:versionId"
            element={<AssistantHubReviewPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const settle = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("AssistantHubReviewPage", () => {
  beforeEach(() => {
    versions = [makeVersion("first"), makeVersion("second")];
    for (const mutation of [
      reviewVersion,
      setPublished,
      setCurrent,
      setFeatured,
    ]) {
      mutation.mockReset();
      mutation.mockResolvedValue({});
    }
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps only the clicked row busy until the queue has refetched", async () => {
    const queryClient = new QueryClient();
    const publish = deferred();
    setPublished.mockReturnValueOnce(publish.promise);
    const refetch = deferred();
    vi.spyOn(queryClient, "invalidateQueries").mockReturnValue(refetch.promise);

    renderPage("/assistant-hub/review", queryClient);

    const [firstPublish, secondPublish] = screen.getAllByRole("button", {
      name: "Publish",
    });
    fireEvent.click(firstPublish);
    await settle();

    expect(firstPublish).toHaveAttribute("aria-busy", "true");
    expect(secondPublish).not.toHaveAttribute("aria-busy");

    await act(async () => {
      publish.resolve();
      await publish.promise;
    });
    await settle();

    expect(setPublished).toHaveBeenCalledTimes(1);
    expect(firstPublish).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      refetch.resolve();
      await refetch.promise;
    });

    expect(firstPublish).not.toHaveAttribute("aria-busy");
  });

  it("refreshes the hub views, the start screen and the version's assistant, not every query", async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    renderPage("/assistant-hub/review", queryClient);

    fireEvent.click(screen.getAllByRole("button", { name: "Publish" })[0]);
    await settle();

    expect(invalidateQueries.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: ["api", "v1beta", "assistant-hub"] },
      { queryKey: ["api", "v1beta", "me", "starting-assistant"] },
      { queryKey: ["api", "v1beta", "assistants", "first-assistant"] },
    ]);
  });

  it("sends a decision once and confirms it, even when clicked again while the queue refetches", async () => {
    versions = [makeVersion("pending", { status: "submitted" })];
    const queryClient = new QueryClient();
    const refetch = deferred();
    vi.spyOn(queryClient, "invalidateQueries").mockReturnValue(refetch.promise);

    renderPage("/assistant-hub/review/pending", queryClient);

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await settle();

    expect(reviewVersion).toHaveBeenCalledTimes(1);
    expect(reviewVersion.mock.calls[0][0].body.accepted).toBe(true);
    expect(useToastStore.getState().toasts).toEqual([]);

    await act(async () => {
      refetch.resolve();
      await refetch.promise;
    });

    expect(useToastStore.getState().toasts).toMatchObject([
      { variant: "success", title: "Version accepted." },
    ]);
  });

  it("reports a failed action in a toast that a successful retry dismisses", async () => {
    setPublished.mockRejectedValueOnce(new Error("boom"));

    renderPage("/assistant-hub/review");

    fireEvent.click(screen.getAllByRole("button", { name: "Publish" })[0]);
    await settle();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(useToastStore.getState().toasts).toMatchObject([
      {
        variant: "error",
        title: "Failed to update assistant hub review state.",
      },
    ]);

    fireEvent.click(screen.getAllByRole("button", { name: "Publish" })[0]);
    await settle();

    expect(setPublished).toHaveBeenCalledTimes(2);
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
