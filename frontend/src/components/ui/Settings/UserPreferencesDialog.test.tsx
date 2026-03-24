import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ThemeProvider,
  type ThemeMode,
} from "@/components/providers/ThemeProvider";
import { profileQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import { UserPreferencesDialog } from "./UserPreferencesDialog";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";
import type { ReactNode } from "react";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../Feedback/Alert", () => ({
  Alert: ({ children }: { children: ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));

vi.mock("../Controls/Button", () => ({
  Button: ({
    children,
    confirmAction,
    confirmTitle: _confirmTitle,
    confirmMessage: _confirmMessage,
    onClick,
    ...props
  }: React.ComponentProps<"button"> & {
    confirmAction?: boolean;
    confirmTitle?: string;
    confirmMessage?: string;
  }) => (
    <>
      <button type="button" onClick={onClick} {...props}>
        {children}
      </button>
      {confirmAction && (
        <button type="button" onClick={onClick}>
          Confirm action
        </button>
      )}
    </>
  ),
}));

const userProfile: UserProfile = {
  id: "user-1",
  groups: ["engineering"],
  organization_group_ids: ["org-group-1"],
  preferred_language: "en",
  name: "Max Mustermann",
  email: "max.mustermann@example.com",
  preference_nickname: "Max",
  preference_job_title: "Product Manager",
  preference_assistant_custom_instructions:
    "Prefer concise bullet points and highlight risks first.",
  preference_assistant_additional_information:
    "I work with enterprise customers in regulated industries.",
};

const createJsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function renderDialog({
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  }),
  onClose = vi.fn(),
  profile = userProfile,
  themeMode = "light",
  userPreferencesEnabled = true,
}: {
  queryClient?: QueryClient;
  onClose?: () => void;
  profile?: UserProfile;
  themeMode?: ThemeMode;
  userPreferencesEnabled?: boolean;
} = {}) {
  return render(
    <MemoryRouter>
      <StaticFeatureConfigProvider
        config={{ userPreferences: { enabled: userPreferencesEnabled } }}
      >
        <ThemeProvider
          initialThemeMode={themeMode}
          persistThemeMode={false}
          enableCustomTheme={false}
        >
          <QueryClientProvider client={queryClient}>
            <UserPreferencesDialog
              isOpen={true}
              onClose={onClose}
              userProfile={profile}
            />
          </QueryClientProvider>
        </ThemeProvider>
      </StaticFeatureConfigProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("UserPreferencesDialog", () => {
  it("renders accessible vertical tabs and linked tabpanels", () => {
    renderDialog();

    const tablist = screen.getByRole("tablist", { name: "Preferences" });
    const personalizationTab = screen.getByRole("tab", {
      name: "Personalization",
    });
    const appearanceTab = screen.getByRole("tab", { name: "Appearance" });
    const dataTab = screen.getByRole("tab", { name: "Data" });
    const personalizationPanel = screen.getByRole("tabpanel", {
      name: "Personalization",
    });
    const appearancePanelId = appearanceTab.getAttribute("aria-controls");
    const appearancePanel =
      appearancePanelId !== null
        ? document.getElementById(appearancePanelId)
        : null;
    const dataPanelId = dataTab.getAttribute("aria-controls");
    const dataPanel =
      dataPanelId !== null ? document.getElementById(dataPanelId) : null;

    expect(tablist).toHaveAttribute("aria-orientation", "vertical");
    expect(personalizationTab).toHaveAttribute("aria-selected", "true");
    expect(appearanceTab).toHaveAttribute("aria-selected", "false");
    expect(dataTab).toHaveAttribute("aria-selected", "false");
    expect(personalizationTab).toHaveAttribute(
      "aria-controls",
      personalizationPanel.id,
    );
    expect(appearancePanel).not.toBeNull();
    expect(appearanceTab).toHaveAttribute("aria-controls", appearancePanel?.id);
    expect(dataPanel).not.toBeNull();
    expect(dataTab).toHaveAttribute("aria-controls", dataPanel?.id);
    expect(personalizationPanel).not.toHaveAttribute("hidden");
    expect(appearancePanel).toHaveAttribute("hidden");
    expect(dataPanel).toHaveAttribute("hidden");
  });

  it("switches panels and only shows footer actions on the personalization tab", () => {
    renderDialog();

    fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));

    expect(
      screen.getByRole("tabpanel", { name: "Appearance" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Color mode")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Personalization" }));

    expect(
      screen.getByRole("tabpanel", { name: "Personalization" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("supports keyboard navigation between visible tabs", () => {
    renderDialog();

    const personalizationTab = screen.getByRole("tab", {
      name: "Personalization",
    });
    const appearanceTab = screen.getByRole("tab", { name: "Appearance" });

    personalizationTab.focus();
    fireEvent.keyDown(personalizationTab, { key: "ArrowDown" });

    expect(appearanceTab).toHaveFocus();
    expect(appearanceTab).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tabpanel", { name: "Appearance" }),
    ).toBeInTheDocument();
  });

  it("shows appearance and data tabs when personalization is disabled", () => {
    renderDialog({ userPreferencesEnabled: false, themeMode: "system" });

    expect(
      screen.queryByRole("tab", { name: "Personalization" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Appearance" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("tabpanel", { name: "Appearance" }),
    ).toHaveTextContent("Currently light");
  });

  it("updates the selected theme mode from the appearance pane", () => {
    renderDialog({ themeMode: "light" });

    fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    fireEvent.click(screen.getByRole("radio", { name: /Dark mode/i }));

    expect(screen.getByRole("radio", { name: /Dark mode/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("archives chats, refreshes recent chats, and redirects to a new chat", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
      },
    });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const refetchQueries = vi.spyOn(queryClient, "refetchQueries");
    const onClose = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ archived_chat_count: 2 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    renderDialog({ queryClient, onClose });

    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive all chats" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1beta/me/chats/archive_all",
        expect.objectContaining({
          method: "POST",
        }),
      );
      expect(invalidateQueries).toHaveBeenCalled();
      expect(refetchQueries).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith("/chat/new", { replace: true });
    });
  });

  it("saves preferences via the generated API helper and refreshes the profile query", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
      },
    });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const onClose = vi.fn();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(createJsonResponse(userProfile));

    renderDialog({ queryClient, onClose });

    fireEvent.change(screen.getByLabelText("Nickname"), {
      target: { value: "Maximilian" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const requestCall = fetchMock.mock.calls.find(
        ([url]) => url === "/api/v1beta/me/profile/preferences",
      );

      expect(requestCall).toBeDefined();
      expect(requestCall?.[1]).toEqual(
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );
      expect(JSON.parse(String(requestCall?.[1]?.body))).toEqual({
        preference_nickname: "Maximilian",
        preference_job_title: "Product Manager",
        preference_assistant_custom_instructions:
          "Prefer concise bullet points and highlight risks first.",
        preference_assistant_additional_information:
          "I work with enterprise customers in regulated industries.",
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: profileQuery({}).queryKey,
      });
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("shows a save error when updating preferences fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      createJsonResponse({ message: "boom" }, 500),
    );

    renderDialog();

    fireEvent.change(screen.getByLabelText("Nickname"), {
      target: { value: "Maximilian" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(
        screen.getByText("Could not save preferences. Please try again."),
      ).toBeInTheDocument();
    });
  });
});
