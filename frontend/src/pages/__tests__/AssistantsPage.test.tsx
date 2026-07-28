import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import AssistantsPage from "../AssistantsPage";

import type {
  Assistant,
  AssistantHubVersion,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

let assistantHubEnabled = true;
let assistantHubConfigLoading = false;
let assistants: Assistant[] = [];
let publishedHubVersions: AssistantHubVersion[] = [];
let hubVersions: AssistantHubVersion[] = [];

const useListAssistants = vi.fn((_variables?: unknown) => ({
  data: assistants,
  isLoading: false,
  error: null,
  refetch: vi.fn(),
}));
const useListAssistantHubAssistants = vi.fn((_variables?: unknown) => ({
  data: { versions: publishedHubVersions },
  isLoading: false,
  error: null,
}));
const useListMyAssistantHubVersions = vi.fn((_variables?: unknown) => ({
  data: { versions: hubVersions },
  isLoading: false,
  error: null,
}));

vi.mock("@/hooks/ui", () => ({
  usePageAlignment: () => ({
    containerClasses: "container",
    horizontalPadding: "px-4",
  }),
}));

vi.mock("@/hooks/useDateFnsLocale", () => ({
  useDateFnsLocale: () => undefined,
}));

vi.mock("@/hooks/ui/useThemedIcon", () => ({
  useThemedIcon: () => null,
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useArchiveAssistant: () => ({
    mutateAsync: vi.fn(),
  }),
  useAssistantHubConfig: () => ({
    data: assistantHubConfigLoading
      ? undefined
      : {
          enabled: assistantHubEnabled,
          can_review: true,
          categories: [],
        },
    isLoading: assistantHubConfigLoading,
    error: null,
  }),
  useListAssistantHubAssistants: (variables: unknown) =>
    useListAssistantHubAssistants(variables),
  useListAssistants: (variables: unknown) => useListAssistants(variables),
  useListMyAssistantHubVersions: (variables: unknown) =>
    useListMyAssistantHubVersions(variables),
}));

vi.mock("../assistantHubUtils", () => ({
  AssistantHubBreadcrumb: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick: () => void;
  }) => <button onClick={onClick}>{children}</button>,
  AssistantHubVersionCard: ({
    actions,
    onOpen,
  }: {
    actions?: React.ReactNode;
    onOpen?: () => void;
  }) => (
    <div>
      <button data-testid="hub-card" onClick={onOpen}>
        Hub card
      </button>
      {actions}
    </div>
  ),
  EmptyAssistantHubState: ({
    action,
    description,
    title,
  }: {
    action?: React.ReactNode;
    description: string;
    title: string;
  }) => (
    <div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  ),
  isAssistantHubReviewAcceptedStatus: (status: string) =>
    status === "review_accepted" || status === "accepted",
  isAssistantHubReviewDeclinedStatus: (status: string) =>
    status === "review_declined" || status === "declined",
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

const createAssistant = (
  id: string,
  name: string,
  archivedAt?: string,
): Assistant => ({
  id,
  name,
  description: `${name} description`,
  prompt: `${name} prompt`,
  can_edit: true,
  enforce_facet_settings: false,
  archived_at: archivedAt,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

const createHubVersion = ({
  sourceAssistantId,
  status,
  isPublished = false,
}: {
  sourceAssistantId: string;
  status: string;
  isPublished?: boolean;
}) =>
  ({
    source_assistant_id: sourceAssistantId,
    status,
    is_published: isPublished,
    submitted_at: "2026-01-02T00:00:00Z",
  }) as AssistantHubVersion;

function renderRoutes(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <I18nProvider i18n={i18n}>
        <Routes>
          <Route
            path="/assistant-hub"
            element={<AssistantsPage view="hub" />}
          />
          <Route
            path="/assistants"
            element={<AssistantsPage view="shared_with_user" />}
          />
          <Route
            path="/assistants/created"
            element={<AssistantsPage view="owned_by_user" />}
          />
        </Routes>
        <LocationProbe />
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("AssistantsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    assistantHubEnabled = true;
    assistantHubConfigLoading = false;
    assistants = [];
    publishedHubVersions = [];
    hubVersions = [];
    useListAssistants.mockClear();
    useListAssistantHubAssistants.mockClear();
    useListMyAssistantHubVersions.mockClear();
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  it("shows all three URL-backed views when the hub is enabled", () => {
    const { container } = renderRoutes("/assistant-hub");

    const toolbar = container.querySelector(
      '[data-ui="assistants-page-toolbar"]',
    );
    const scrollContainer = container.querySelector(
      '[data-ui="assistants-page-scroll-container"]',
    );
    const hubTab = screen.getByRole("tab", { name: "Assistant Hub" });

    expect(scrollContainer).toHaveClass("[scrollbar-gutter:stable_both-edges]");
    expect(hubTab).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tab", { name: "My assistants" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Shared with me" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Assistant Hub",
      "My assistants",
      "Shared with me",
    ]);
    expect(
      screen.getByRole("heading", { name: "Assistants" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create Assistant" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: "Search assistants" }),
    ).toBeInTheDocument();
    expect(toolbar).toContainElement(hubTab);
    expect(toolbar).toContainElement(
      screen.getByRole("button", { name: "My submissions" }),
    );
    expect(toolbar).toContainElement(
      screen.getByRole("button", { name: "Review queue" }),
    );
    expect(useListAssistantHubAssistants).toHaveBeenCalledOnce();
    expect(useListAssistants).not.toHaveBeenCalled();
  });

  it("falls back from the hub URL to shared assistants when the hub is disabled", () => {
    assistantHubEnabled = false;

    renderRoutes("/assistant-hub");

    expect(screen.getByTestId("location")).toHaveTextContent("/assistants");
    expect(useListAssistants).toHaveBeenCalledWith({
      queryParams: { sharing_relation: "shared_with_user" },
    });
  });

  it("highlights featured assistants with an introduction", () => {
    publishedHubVersions = [
      {
        ...createHubVersion({
          sourceAssistantId: "featured",
          status: "review_accepted",
          isPublished: true,
        }),
        assistant: {
          created_at: "2026-01-01T00:00:00Z",
          description: "Featured assistant description",
          enforce_facet_settings: false,
          id: "featured-snapshot",
          name: "Featured assistant",
          prompt: "Featured assistant prompt",
          updated_at: "2026-01-02T00:00:00Z",
        },
        category_ids: [],
        featured: true,
        hub_assistant_id: "featured-hub-assistant",
        published_at: "2026-01-02T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        version_id: "featured-version",
      },
    ];

    renderRoutes("/assistant-hub");

    expect(
      screen.getByRole("heading", { name: "Featured assistants" }),
    ).toBeInTheDocument();
    expect(screen.getByText("✨")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Hand-picked assistants that have proven useful to colleagues.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "View" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByTestId("hub-card")[0]);
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/assistant-hub/featured-hub-assistant",
    );
  });

  it("shows all assistants in endlessly scrolling pages of 18", () => {
    let intersectionCallback: IntersectionObserverCallback | undefined;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        readonly root = null;
        readonly rootMargin = "0px";
        readonly thresholds = [0];

        constructor(callback: IntersectionObserverCallback) {
          intersectionCallback = callback;
        }

        disconnect() {}
        observe() {}
        takeRecords() {
          return [];
        }
        unobserve() {}
      },
    );
    publishedHubVersions = Array.from({ length: 19 }, (_, index) => ({
      ...createHubVersion({
        sourceAssistantId: `source-${index}`,
        status: "review_accepted",
        isPublished: true,
      }),
      assistant: {
        created_at: "2026-01-01T00:00:00Z",
        enforce_facet_settings: false,
        id: `assistant-${index}`,
        name: `Assistant ${index}`,
        prompt: `Prompt ${index}`,
        updated_at: "2026-01-02T00:00:00Z",
      },
      category_ids: [],
      featured: false,
      hub_assistant_id: `hub-${index}`,
      published_at: "2026-01-02T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      version_id: `version-${index}`,
    }));

    renderRoutes("/assistant-hub");

    expect(
      screen.getByRole("heading", { name: "All assistants" }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("hub-card")).toHaveLength(18);
    expect(
      screen.getByTestId("assistant-hub-load-more-sentinel"),
    ).toBeInTheDocument();

    act(() => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(screen.getAllByTestId("hub-card")).toHaveLength(19);
    expect(
      screen.queryByTestId("assistant-hub-load-more-sentinel"),
    ).not.toBeInTheDocument();
  });

  it("keeps the shared assistants URL available when the hub is enabled", () => {
    renderRoutes("/assistants");

    expect(screen.getByTestId("location")).toHaveTextContent("/assistants");
    expect(screen.getByRole("tab", { name: "Shared with me" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(useListAssistants).toHaveBeenCalledWith({
      queryParams: { sharing_relation: "shared_with_user" },
    });
  });

  it("keeps archived assistants hidden when the Hub is disabled", () => {
    assistantHubEnabled = false;

    renderRoutes("/assistants/created");

    expect(useListAssistants).toHaveBeenCalledWith({
      queryParams: {
        sharing_relation: "owned_by_user",
      },
    });
    expect(screen.getByRole("tab", { name: "My assistants" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("filters my assistants by their latest Hub lifecycle status", () => {
    assistants = [
      createAssistant("pending", "Pending assistant"),
      createAssistant("published", "Published assistant"),
      createAssistant("unpublished", "Unpublished assistant"),
      createAssistant("declined", "Declined assistant"),
      createAssistant("draft", "Draft assistant"),
      createAssistant("archived", "Archived assistant", "2026-01-03T00:00:00Z"),
    ];
    hubVersions = [
      createHubVersion({
        sourceAssistantId: "pending",
        status: "submitted",
      }),
      createHubVersion({
        sourceAssistantId: "published",
        status: "review_accepted",
        isPublished: true,
      }),
      createHubVersion({
        sourceAssistantId: "unpublished",
        status: "review_accepted",
      }),
      createHubVersion({
        sourceAssistantId: "declined",
        status: "review_declined",
      }),
    ];

    renderRoutes("/assistants/created");

    expect(useListAssistants).toHaveBeenCalledWith({
      queryParams: {
        include_archived: true,
        sharing_relation: "owned_by_user",
      },
    });
    expect(
      screen.getByRole("group", {
        name: "Filter my assistants by Hub status",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All (6)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Not submitted (1)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Archived (1)" }),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("group", {
          name: "Filter my assistants by Hub status",
        })
        .querySelectorAll("button"),
    ).toHaveLength(7);
    expect(
      Array.from(
        screen
          .getByRole("group", {
            name: "Filter my assistants by Hub status",
          })
          .querySelectorAll("button"),
      ).map((button) => button.textContent),
    ).toEqual([
      "All (6)",
      "Not submitted (1)",
      "In review (1)",
      "Published (1)",
      "Unpublished (1)",
      "Declined (1)",
      "Archived (1)",
    ]);
    expect(useListMyAssistantHubVersions).toHaveBeenCalledWith({});

    const allFilter = screen.getByRole("button", { name: "All (6)" });
    const inReviewFilter = screen.getByRole("button", {
      name: "In review (1)",
    });

    fireEvent.click(inReviewFilter);
    expect(allFilter).toHaveClass("font-medium");
    expect(inReviewFilter).toHaveClass("font-medium");
    expect(screen.getByText("Pending assistant")).toBeInTheDocument();
    expect(screen.queryByText("Published assistant")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Archived (1)" }));
    expect(screen.getByText("Archived assistant")).toBeInTheDocument();
    expect(screen.queryByText("Pending assistant")).not.toBeInTheDocument();
  });

  it("keeps assistant lists available when the hub is disabled", () => {
    assistantHubEnabled = false;

    renderRoutes("/assistants");

    expect(screen.getByRole("tab", { name: "Shared with me" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(useListAssistants).toHaveBeenCalledWith({
      queryParams: { sharing_relation: "shared_with_user" },
    });
    expect(useListAssistantHubAssistants).not.toHaveBeenCalled();
  });
});
