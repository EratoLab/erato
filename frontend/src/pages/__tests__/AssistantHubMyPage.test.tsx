import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useToastStore } from "@/components/ui/Toast/toastStore";

import AssistantHubMyPage, {
  getVisibleAssistantHubVersions,
  groupVersionsByAssistant,
} from "../AssistantHubMyPage";

import type { AssistantHubVersion } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const versions = [
  { version_id: "latest" },
  { version_id: "previous" },
  { version_id: "oldest" },
] as AssistantHubVersion[];

const groupedVersions = [
  {
    version_id: "older-assistant-version",
    hub_assistant_id: "older-assistant",
    submitted_at: "2026-08-04T12:00:00Z",
    assistant: { name: "Alpha" },
  },
  {
    version_id: "newer-assistant-version",
    hub_assistant_id: "newer-assistant",
    submitted_at: "2026-08-05T12:00:00Z",
    assistant: { name: "Zulu" },
  },
] as AssistantHubVersion[];

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

let myVersions: AssistantHubVersion[];
let listError: Error | null;
const withdrawVersion = vi.fn();
const setPublished = vi.fn();
const setCurrent = vi.fn();

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

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useAssistantHubConfig: () => ({
    data: { enabled: true, can_review: false, categories: [] },
  }),
  useListMyAssistantHubVersions: () => ({
    data: { versions: myVersions },
    isLoading: false,
    error: listError,
  }),
  useGetAssistant: () => ({ data: undefined }),
  useListAssistantHubReviews: () => ({ data: undefined, isLoading: false }),
  useWithdrawAssistantHubVersion: () =>
    useMutation({ mutationFn: withdrawVersion }),
  useSetAssistantHubVersionPublished: () =>
    useMutation({ mutationFn: setPublished }),
  useSetAssistantHubVersionCurrent: () =>
    useMutation({ mutationFn: setCurrent }),
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

function renderPage(queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/assistant-hub/my"]}>
        <Routes>
          <Route path="/assistant-hub/my" element={<AssistantHubMyPage />} />
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

describe("getVisibleAssistantHubVersions", () => {
  it("shows only the latest version initially when more than two exist", () => {
    expect(
      getVisibleAssistantHubVersions(versions, false).map(
        (version) => version.version_id,
      ),
    ).toEqual(["latest"]);
  });

  it("shows all versions after expansion", () => {
    expect(
      getVisibleAssistantHubVersions(versions, true).map(
        (version) => version.version_id,
      ),
    ).toEqual(["latest", "previous", "oldest"]);
  });

  it("keeps groups with two or fewer versions fully visible", () => {
    expect(
      getVisibleAssistantHubVersions(versions.slice(0, 2), false).map(
        (version) => version.version_id,
      ),
    ).toEqual(["latest", "previous"]);
  });
});

describe("groupVersionsByAssistant", () => {
  it("orders assistants by their most recent submission", () => {
    expect(
      groupVersionsByAssistant(groupedVersions).map(
        (group) => group.hubAssistantId,
      ),
    ).toEqual(["newer-assistant", "older-assistant"]);
  });
});

describe("AssistantHubMyPage", () => {
  beforeEach(() => {
    myVersions = [makeVersion("first"), makeVersion("second")];
    listError = null;
    for (const mutation of [withdrawVersion, setPublished, setCurrent]) {
      mutation.mockReset();
      mutation.mockResolvedValue({});
    }
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a withdrawal busy until the list has refetched, then confirms it", async () => {
    myVersions = [makeVersion("pending", { status: "submitted" })];
    const queryClient = new QueryClient();
    const refetch = deferred();
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockReturnValue(refetch.promise);

    renderPage(queryClient);

    const withdraw = screen.getByRole("button", { name: "Withdraw" });
    fireEvent.click(withdraw);
    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
    await settle();

    expect(withdrawVersion).toHaveBeenCalledTimes(1);
    expect(withdraw).toHaveAttribute("aria-busy", "true");
    expect(invalidateQueries.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: ["api", "v1beta", "assistant-hub"] },
      { queryKey: ["api", "v1beta", "me", "starting-assistant"] },
      { queryKey: ["api", "v1beta", "assistants", "pending-assistant"] },
    ]);

    await act(async () => {
      refetch.resolve();
      await refetch.promise;
    });

    expect(withdraw).not.toHaveAttribute("aria-busy");
    expect(useToastStore.getState().toasts).toMatchObject([
      { variant: "success", title: "Submission withdrawn." },
    ]);
  });

  it("spins only the clicked row, and reports a failure in a toast instead of an alert", async () => {
    let failPublish!: (error: Error) => void;
    setPublished.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failPublish = reject;
        }),
    );

    renderPage();

    const [firstPublish, secondPublish] = screen.getAllByRole("button", {
      name: "Publish",
    });
    fireEvent.click(firstPublish);
    await settle();

    expect(firstPublish).toHaveAttribute("aria-busy", "true");
    expect(secondPublish).not.toHaveAttribute("aria-busy");

    failPublish(new Error("boom"));
    await settle();

    expect(firstPublish).not.toHaveAttribute("aria-busy");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(useToastStore.getState().toasts).toMatchObject([
      { variant: "error", title: "Failed to update hub submissions." },
    ]);
  });

  it("says the submissions could not be loaded when the list fails", () => {
    listError = new Error("500");

    renderPage();

    expect(
      screen.getByText("Could not load your hub submissions."),
    ).toBeInTheDocument();
  });
});
