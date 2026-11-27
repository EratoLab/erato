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
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";
import {
  ORGANIZATION_SUBJECT_ID,
  ORGANIZATION_SUBJECT_ID_TYPE,
} from "@/types/sharing";

import AssistantHubSubmitPage from "../AssistantHubSubmitPage";

import type { AssistantHubAudienceGrantInput } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

const defaultHubConfig = {
  enabled: true,
  enable_categories: true,
  default_share_with_whole_organization: false,
  force_whole_organization_audience: false,
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

const organizationViewerGrant = {
  subject_type: "organization",
  subject_id_type: ORGANIZATION_SUBJECT_ID_TYPE,
  subject_id: ORGANIZATION_SUBJECT_ID,
  role: "viewer",
};

const submittedVersion = (versionId: string, submittedAt: string) => ({
  version_id: versionId,
  assistant_id: `${versionId}-clone`,
  source_assistant_id: "assistant-1",
  submitted_at: submittedAt,
  version_number: "1.0.0",
  status: "submitted",
  long_description: "Turns changelogs into release notes",
  keywords: [],
  category_ids: ["research"],
  is_published: false,
  is_current_published_version: false,
});

let hubConfig: typeof defaultHubConfig;
let myVersions: ReturnType<typeof submittedVersion>[];
let isLoadingMyVersions: boolean;
let loadedShareGrants: Map<string, AssistantHubAudienceGrantInput[]>;
let validateVersionSemverFormat: boolean | undefined;
const submitVersion = vi.fn();
const previewDiff = vi.fn();

vi.mock("@/hooks/ui", () => ({
  usePageAlignment: () => ({
    containerClasses: "container",
    horizontalPadding: "px-4",
  }),
}));

vi.mock("@/hooks/sharing", () => ({
  useOrganizationMembersSearch: () => ({
    members: [],
    isLoading: false,
    error: null,
    isSearching: false,
  }),
}));

vi.mock("@/components/ui/Feedback/Alert", () => ({
  Alert: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useAssistantHubConfig: () => ({
    data: {
      ...hubConfig,
      validate_version_semver_format: validateVersionSemverFormat,
    },
    isLoading: false,
  }),
  useGetAssistant: () => ({ data: assistant, isLoading: false, error: null }),
  useListMyAssistantHubVersions: () => ({
    data: isLoadingMyVersions ? undefined : { versions: myVersions },
    isLoading: isLoadingMyVersions,
  }),
  useListShareGrants: (
    variables: typeof skipToken | { queryParams: { resource_id: string } },
  ) => {
    const grants =
      variables === skipToken
        ? []
        : loadedShareGrants.get(variables.queryParams.resource_id);
    return { data: grants && { grants }, isLoading: grants === undefined };
  },
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
    hubConfig = { ...defaultHubConfig };
    myVersions = [];
    isLoadingMyVersions = false;
    loadedShareGrants = new Map();
    validateVersionSemverFormat = undefined;
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

  it("submits the full organization as the Hub audience when the direct picker hides it", async () => {
    render(
      <StaticFeatureConfigProvider
        config={{ assistants: { enableDirectOrganizationSharing: false } }}
      >
        {page(new QueryClient())}
      </StaticFeatureConfigProvider>,
    );

    expect(screen.getByText("Full organization")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Research" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit version" }));

    await waitFor(() => expect(submitVersion).toHaveBeenCalledTimes(1));
    expect(submitVersion.mock.calls[0][0].body.audience_grants).toEqual([
      organizationViewerGrant,
    ]);
  });

  it("preselects the whole organization for a first submission when configured", async () => {
    hubConfig.default_share_with_whole_organization = true;
    renderPage();

    expect(screen.getByRole("heading", { name: "Hub audience" })).toBeVisible();
    expect(screen.getByRole("checkbox")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Research" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit version" }));

    await waitFor(() => expect(submitVersion).toHaveBeenCalledTimes(1));
    expect(submitVersion.mock.calls[0][0].body.audience_grants).toEqual([
      organizationViewerGrant,
    ]);
  });

  it("prefills the latest submission's audience over the first-submission default", async () => {
    hubConfig.default_share_with_whole_organization = true;
    isLoadingMyVersions = true;
    const queryClient = new QueryClient();
    const { rerender } = renderPage(queryClient);

    const previousGrant = {
      subject_type: "user",
      subject_id_type: "id",
      subject_id: "previous-viewer",
      role: "viewer",
    };
    myVersions = [submittedVersion("first", "2026-01-01T00:00:00Z")];
    loadedShareGrants.set("first-clone", [previousGrant]);
    isLoadingMyVersions = false;
    rerender(page(queryClient));

    expect(screen.getByRole("heading", { name: "Hub audience" })).toBeVisible();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Submit version" }));

    await waitFor(() => expect(submitVersion).toHaveBeenCalledTimes(1));
    expect(submitVersion.mock.calls[0][0].body.audience_grants).toEqual([
      previousGrant,
    ]);
  });

  it.each(["first submission", "new version"])(
    "hides the fixed audience for a %s",
    async (submission) => {
      hubConfig.force_whole_organization_audience = true;
      if (submission === "new version") {
        myVersions = [submittedVersion("first", "2026-01-01T00:00:00Z")];
        // Leave prior grants unloaded to verify this form can submit without them.
      }

      renderPage();

      expect(
        screen.queryByRole("heading", { name: "Hub audience" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      if (submission === "first submission") {
        fireEvent.click(screen.getByRole("button", { name: "Research" }));
      }
      fireEvent.click(screen.getByRole("button", { name: "Submit version" }));

      await waitFor(() => expect(submitVersion).toHaveBeenCalledTimes(1));
      expect(
        submitVersion.mock.calls[0][0].body.audience_grants,
      ).toBeUndefined();
    },
  );

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

  it.each([undefined, false])(
    "keeps legacy labels and suggestions when the flag is %s",
    async (flag) => {
      validateVersionSemverFormat = flag;
      myVersions = [
        {
          ...submittedVersion("first", "2026-01-01T00:00:00Z"),
          version_number: "5",
        },
      ];
      loadedShareGrants.set("first-clone", []);
      renderPage();

      const input = screen.getByRole("textbox", { name: /Version number/ });
      expect(input).toHaveValue("6");
      fireEvent.change(input, { target: { value: "release-candidate" } });
      fireEvent.click(screen.getByRole("button", { name: "Submit version" }));

      await waitFor(() => expect(submitVersion).toHaveBeenCalledTimes(1));
      expect(submitVersion.mock.calls[0][0].body.version_number).toBe(
        "release-candidate",
      );
    },
  );

  it("suggests 1.0.0 when history has no comparable version and accepts another starting value", async () => {
    validateVersionSemverFormat = true;
    myVersions = [
      {
        ...submittedVersion("legacy", "2026-01-01T00:00:00Z"),
        version_number: "v99.0.0",
      },
    ];
    loadedShareGrants.set("legacy-clone", []);
    renderPage();

    const input = screen.getByRole("textbox", { name: /Version number/ });
    expect(input).toHaveValue("1.0.0");
    expect(input).toHaveAccessibleDescription(/Use MAJOR\.MINOR\.PATCH/);
    fireEvent.change(input, { target: { value: " 0.1.0 " } });
    fireEvent.click(screen.getByRole("button", { name: "Submit version" }));

    await waitFor(() => expect(submitVersion).toHaveBeenCalledTimes(1));
    expect(submitVersion.mock.calls[0][0].body.version_number).toBe(" 0.1.0 ");
  });

  it("suggests a patch above the numeric maximum across submission statuses", () => {
    validateVersionSemverFormat = true;
    myVersions = [
      {
        ...submittedVersion("published", "2026-03-01T00:00:00Z"),
        version_number: "1.9.0",
        is_published: true,
        is_current_published_version: true,
      },
      {
        ...submittedVersion("withdrawn", "2026-02-01T00:00:00Z"),
        version_number: "1.10.0",
        status: "withdrawn",
      },
      {
        ...submittedVersion("legacy", "2026-01-01T00:00:00Z"),
        version_number: "99.0.0-preview",
      },
      {
        ...submittedVersion("unrelated", "2026-04-01T00:00:00Z"),
        source_assistant_id: "assistant-2",
        version_number: "99.0.0",
      },
    ];
    loadedShareGrants.set("published-clone", []);
    renderPage();

    const input = screen.getByRole("textbox", { name: /Version number/ });
    expect(input).toHaveValue("1.10.1");
    fireEvent.change(input, { target: { value: "1.10.0" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit version" }));
    expect(input).toHaveAccessibleDescription(
      /Enter a version greater than 1\.10\.0/,
    );
    expect(submitVersion).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "1.010.0" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(input).toHaveAccessibleDescription(
      /Enter a version in MAJOR\.MINOR\.PATCH format/,
    );
    expect(previewDiff).not.toHaveBeenCalled();
  });

  it.each([
    [
      { code: "invalid_version_format" },
      "Enter a version in MAJOR.MINOR.PATCH format.",
    ],
    [
      { code: "version_not_increasing", current_version: "1.10.0" },
      "Enter a version greater than 1.10.0.",
    ],
  ])(
    "shows a server rejection on the field and keeps the entered value",
    async (error, message) => {
      validateVersionSemverFormat = true;
      submitVersion.mockRejectedValueOnce(error);
      renderPage();

      const input = screen.getByRole("textbox", { name: /Version number/ });
      fireEvent.click(screen.getByRole("button", { name: "Research" }));
      fireEvent.change(input, { target: { value: "1.2.3" } });
      fireEvent.click(screen.getByRole("button", { name: "Submit version" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(input).toHaveValue("1.2.3");
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(useToastStore.getState().toasts).toEqual([]);

      fireEvent.change(input, { target: { value: "1.10.1" } });
      expect(input).toHaveAttribute("aria-invalid", "false");
      fireEvent.click(screen.getByRole("button", { name: "Submit version" }));
      expect(await screen.findByTestId("my-submissions")).toBeInTheDocument();
    },
  );

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
    loadedShareGrants.set("first-clone", []);
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
