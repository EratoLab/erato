import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  QueryClient,
  QueryClientProvider,
  skipToken,
  useMutation,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useToastStore } from "@/components/ui/Toast/toastStore";
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

const myVersionsKey = ["api", "v1beta", "assistant-hub", "my", "versions"];
const reviewVersionsKey = [
  "api",
  "v1beta",
  "assistant-hub",
  "review",
  "versions",
];

const submittedVersion = (versionId: string, submittedAt: string) => ({
  version_id: versionId,
  assistant_id: `${versionId}-clone`,
  source_assistant_id: "assistant-1",
  submitted_at: submittedAt,
  version_number: "1.0.0",
  long_description: "Turns changelogs into release notes",
  keywords: [],
  category_ids: ["research"],
  is_published: false,
  is_current_published_version: false,
});

let myVersions: ReturnType<typeof submittedVersion>[];
let loadedShareGrants: Set<string>;
const submitVersion = vi.fn();
const previewDiff = vi.fn();

vi.mock("@/hooks/ui", () => ({
  usePageAlignment: () => ({
    containerClasses: "container",
    horizontalPadding: "px-4",
  }),
}));

vi.mock("@/components/ui/Sharing/SubjectSelector", () => ({
  SubjectSelector: () => <div data-testid="subject-selector" />,
}));

vi.mock("@/components/ui/Feedback/Alert", () => ({
  Alert: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useAssistantHubConfig: () => ({ data: hubConfig, isLoading: false }),
  useGetAssistant: () => ({ data: assistant, isLoading: false, error: null }),
  useListMyAssistantHubVersions: () => ({
    data: { versions: myVersions },
    isLoading: false,
  }),
  useListShareGrants: (
    variables: typeof skipToken | { queryParams: { resource_id: string } },
  ) =>
    variables === skipToken ||
    loadedShareGrants.has(variables.queryParams.resource_id)
      ? { data: { grants: [] }, isLoading: false }
      : { data: undefined, isLoading: true },
  usePreviewAssistantHubSubmissionDiff: () =>
    useMutation({ mutationFn: previewDiff }),
  useSubmitAssistantHubVersion: () =>
    useMutation({ mutationFn: submitVersion }),
  useAvailableModels: () => ({ data: undefined }),
  useFacets: () => ({ data: undefined }),
  listMyAssistantHubVersionsQuery: () => ({ queryKey: myVersionsKey }),
  listReviewAssistantHubVersionsQuery: () => ({
    queryKey: reviewVersionsKey,
  }),
}));

const page = (queryClient: QueryClient) => (
  <QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={["/assistant-hub/submit/assistant-1"]}>
      <I18nProvider i18n={i18n}>
        <Routes>
          <Route
            path="/assistant-hub/submit/:sourceAssistantId"
            element={<AssistantHubSubmitPage />}
          />
          <Route
            path="/assistant-hub/my"
            element={<div data-testid="my-submissions" />}
          />
          <Route
            path="/assistants/created"
            element={<div data-testid="assistants-list" />}
          />
        </Routes>
      </I18nProvider>
    </MemoryRouter>
  </QueryClientProvider>
);

const renderPage = (queryClient = new QueryClient()) =>
  render(page(queryClient));

const settle = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

describe("AssistantHubSubmitPage", () => {
  beforeEach(() => {
    myVersions = [];
    loadedShareGrants = new Set();
    submitVersion.mockReset();
    submitVersion.mockResolvedValue({ version: { version_id: "new" } });
    previewDiff.mockReset();
    previewDiff.mockResolvedValue({ diff_summary: {} });
    useToastStore.setState({ toasts: [] });
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("goes to my submissions as soon as the version lands, with it cached and confirmed in a toast", async () => {
    const submitted = { version_id: "new", version_number: "1.0.0" };
    submitVersion.mockResolvedValueOnce({ version: submitted });
    const queryClient = new QueryClient();
    queryClient.setQueryData(myVersionsKey, {
      versions: [{ version_id: "older" }],
    });
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockReturnValue(new Promise(() => {}));

    renderPage(queryClient);

    fireEvent.click(screen.getByRole("button", { name: "Research" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit version" }));
    await settle();

    expect(screen.getByTestId("my-submissions")).toBeInTheDocument();
    expect(queryClient.getQueryData(myVersionsKey)).toEqual({
      versions: [submitted, { version_id: "older" }],
    });
    expect(invalidateQueries.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: myVersionsKey, refetchType: "none" },
      { queryKey: reviewVersionsKey, refetchType: "none" },
    ]);
    expect(useToastStore.getState().toasts).toMatchObject([
      { variant: "success", title: "Version submitted for review." },
    ]);
  });

  it("stays on the form after a failed submission, and a successful retry replaces the error toast", async () => {
    submitVersion.mockRejectedValueOnce(new Error("boom"));

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Research" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit version" }));
    await settle();

    expect(screen.queryByTestId("my-submissions")).not.toBeInTheDocument();
    expect(useToastStore.getState().toasts).toMatchObject([
      { variant: "error", title: "Failed to submit the assistant version." },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Submit version" }));
    await settle();

    expect(screen.getByTestId("my-submissions")).toBeInTheDocument();
    expect(useToastStore.getState().toasts).toMatchObject([
      { variant: "success" },
    ]);
  });

  it("reports a validation problem in a toast that cancelling dismisses", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Submit version" }));
    await settle();

    expect(submitVersion).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toMatchObject([
      { variant: "error", title: "Select at least one hub category." },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByTestId("assistants-list")).toBeInTheDocument();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("keeps the form on screen when a newer submission of this assistant arrives", () => {
    myVersions = [submittedVersion("first", "2026-01-01T00:00:00Z")];
    loadedShareGrants = new Set(["first-clone"]);
    const queryClient = new QueryClient();

    const { rerender } = renderPage(queryClient);
    expect(
      screen.getByRole("button", { name: "Submit version" }),
    ).toBeInTheDocument();

    myVersions = [
      submittedVersion("second", "2026-02-01T00:00:00Z"),
      ...myVersions,
    ];
    rerender(page(queryClient));

    expect(
      screen.getByRole("button", { name: "Submit version" }),
    ).toBeInTheDocument();
  });

  it("reports a failed preview in a toast", async () => {
    previewDiff.mockRejectedValueOnce(new Error("boom"));

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Research" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    await settle();

    expect(useToastStore.getState().toasts).toMatchObject([
      { variant: "error", title: "Failed to preview the submission diff." },
    ]);
  });
});
