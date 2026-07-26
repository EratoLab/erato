import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import AssistantsPage from "../AssistantsPage";

import type { Assistant } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

let assistantHubEnabled = true;
let assistantHubConfigLoading = false;
let assistants: Assistant[] = [];

const useListAssistants = vi.fn((_variables?: unknown) => ({
  data: assistants,
  isLoading: false,
  error: null,
  refetch: vi.fn(),
}));
const useListAssistantHubAssistants = vi.fn((_variables?: unknown) => ({
  data: { versions: [] },
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
}));

vi.mock("../assistantHubUtils", () => ({
  AssistantHubBreadcrumb: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick: () => void;
  }) => <button onClick={onClick}>{children}</button>,
  AssistantHubVersionCard: () => <div data-testid="hub-card" />,
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
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

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
  beforeEach(() => {
    assistantHubEnabled = true;
    assistantHubConfigLoading = false;
    assistants = [];
    useListAssistants.mockClear();
    useListAssistantHubAssistants.mockClear();
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  it("shows all three URL-backed views when the hub is enabled", () => {
    const { container } = renderRoutes("/assistant-hub");

    const toolbar = container.querySelector(
      '[data-ui="assistants-page-toolbar"]',
    );
    const hubTab = screen.getByRole("tab", { name: "Assistant Hub" });

    expect(hubTab).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tab", { name: "Shared with me" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Created by me" }),
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

  it("requests owned assistants for the Created by me URL", () => {
    assistantHubEnabled = false;

    renderRoutes("/assistants/created");

    expect(useListAssistants).toHaveBeenCalledWith({
      queryParams: { sharing_relation: "owned_by_user" },
    });
    expect(screen.getByRole("tab", { name: "Created by me" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
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
