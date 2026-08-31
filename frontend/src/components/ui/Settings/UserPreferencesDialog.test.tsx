import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ThemeProvider,
  type ThemeMode,
} from "@/components/providers/ThemeProvider";
import { profileQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";
import { useAudioInputDeviceStore } from "@/state/audioInputDeviceStore";

import { UserPreferencesDialog } from "./UserPreferencesDialog";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";
import type { ReactNode } from "react";

const mockNavigate = vi.fn();
const localStorageValues = new Map<string, string>();

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
  preference_default_chat_provider: undefined,
};

const createJsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function renderDialog({
  initialEntries = ["/"],
  initialTab,
  mcpServersTabEnabled = true,
  desktopSidecarTabEnabled = false,
  dataTabEnabled = true,
  audioTranscriptionEnabled = false,
  onMcpOauthCallbackHandled,
  pendingMcpOauthCallback = null,
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
  initialEntries?: string[];
  initialTab?:
    | "personalization"
    | "appearance"
    | "audio"
    | "serversTools"
    | "data";
  mcpServersTabEnabled?: boolean;
  desktopSidecarTabEnabled?: boolean;
  dataTabEnabled?: boolean;
  audioTranscriptionEnabled?: boolean;
  onMcpOauthCallbackHandled?: () => void;
  pendingMcpOauthCallback?: {
    code: string;
    serverId: string;
    state: string;
  } | null;
  queryClient?: QueryClient;
  onClose?: () => void;
  profile?: UserProfile;
  themeMode?: ThemeMode;
  userPreferencesEnabled?: boolean;
} = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <StaticFeatureConfigProvider
        config={{
          userPreferences: {
            enabled: userPreferencesEnabled,
            dataTabEnabled,
            mcpServersTabEnabled,
            desktopSidecarTabEnabled,
          },
          audioTranscription: {
            enabled: audioTranscriptionEnabled,
            maxRecordingDurationSeconds: 1200,
          },
        }}
      >
        <ThemeProvider
          initialThemeMode={themeMode}
          persistThemeMode={false}
          enableCustomTheme={false}
        >
          <QueryClientProvider client={queryClient}>
            <UserPreferencesDialog
              isOpen={true}
              initialTab={initialTab}
              onMcpOauthCallbackHandled={onMcpOauthCallbackHandled}
              onClose={onClose}
              pendingMcpOauthCallback={pendingMcpOauthCallback}
              userProfile={profile}
            />
          </QueryClientProvider>
        </ThemeProvider>
      </StaticFeatureConfigProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAudioInputDeviceStore.setState({ selectedDeviceId: "" });
  localStorageValues.clear();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => localStorageValues.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      localStorageValues.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      localStorageValues.delete(key);
    }),
    clear: vi.fn(() => {
      localStorageValues.clear();
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  if (typeof localStorage.clear === "function") {
    localStorage.clear();
  }
});

describe("UserPreferencesDialog", () => {
  it("shows the servers & tools tab when either capability is enabled", () => {
    // Sidecar alone is enough for the merged tab.
    renderDialog({
      desktopSidecarTabEnabled: true,
      mcpServersTabEnabled: false,
    });

    expect(screen.getByRole("tab", { name: "MCP & Apps" })).toBeInTheDocument();

    cleanup();
    renderDialog({
      desktopSidecarTabEnabled: false,
      mcpServersTabEnabled: false,
    });

    expect(
      screen.queryByRole("tab", { name: "MCP & Apps" }),
    ).not.toBeInTheDocument();
  });

  it("renders accessible vertical tabs and linked tabpanels", () => {
    renderDialog();

    const tablist = screen.getByRole("tablist", { name: "Preferences" });
    const personalizationTab = screen.getByRole("tab", {
      name: "Personalization",
    });
    const appearanceTab = screen.getByRole("tab", { name: "Appearance" });
    const mcpServersTab = screen.getByRole("tab", {
      name: "MCP & Apps",
    });
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
    const mcpServersPanelId = mcpServersTab.getAttribute("aria-controls");
    const mcpServersPanel =
      mcpServersPanelId !== null
        ? document.getElementById(mcpServersPanelId)
        : null;

    expect(tablist).toHaveAttribute("aria-orientation", "vertical");
    expect(personalizationTab).toHaveAttribute("aria-selected", "true");
    expect(appearanceTab).toHaveAttribute("aria-selected", "false");
    expect(mcpServersTab).toHaveAttribute("aria-selected", "false");
    expect(dataTab).toHaveAttribute("aria-selected", "false");
    expect(personalizationTab).toHaveAttribute(
      "aria-controls",
      personalizationPanel.id,
    );
    expect(appearancePanel).not.toBeNull();
    expect(appearanceTab).toHaveAttribute("aria-controls", appearancePanel?.id);
    expect(mcpServersPanel).not.toBeNull();
    expect(mcpServersTab).toHaveAttribute("aria-controls", mcpServersPanel?.id);
    expect(dataPanel).not.toBeNull();
    expect(dataTab).toHaveAttribute("aria-controls", dataPanel?.id);
    expect(personalizationPanel).not.toHaveAttribute("hidden");
    expect(appearancePanel).toHaveAttribute("hidden");
    expect(mcpServersPanel).toHaveAttribute("hidden");
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

  it("hides the MCP servers tab when the feature flag is disabled", () => {
    renderDialog({
      mcpServersTabEnabled: false,
    });

    expect(
      screen.queryByRole("tab", { name: "MCP & Apps" }),
    ).not.toBeInTheDocument();
  });

  it("hides the Data tab when the feature flag is disabled", () => {
    renderDialog({
      dataTabEnabled: false,
    });

    expect(screen.queryByRole("tab", { name: "Data" })).not.toBeInTheDocument();
  });

  it("shows an Audio tab when audio transcription is enabled and persists the selected microphone", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: vi.fn(async () => [
          {
            deviceId: "mic-built-in",
            groupId: "group-1",
            kind: "audioinput",
            label: "Built-in Microphone",
            toJSON: () => ({}),
          },
          {
            deviceId: "camera-1",
            groupId: "group-2",
            kind: "videoinput",
            label: "Camera",
            toJSON: () => ({}),
          },
        ]),
      },
    });

    renderDialog({ audioTranscriptionEnabled: true });

    fireEvent.click(screen.getByRole("tab", { name: "Audio" }));

    const audioPanel = await screen.findByRole("tabpanel", { name: "Audio" });
    const trigger = await within(audioPanel).findByTestId(
      "audio-input-dropdown-trigger",
    );
    expect(trigger).toHaveTextContent("System default microphone");

    fireEvent.click(trigger);

    const builtInItem = await screen.findByRole("menuitem", {
      name: "Built-in Microphone",
    });
    fireEvent.click(builtInItem);

    await waitFor(() => {
      expect(useAudioInputDeviceStore.getState().selectedDeviceId).toBe(
        "mic-built-in",
      );
    });
  });

  it("updates the selected theme mode from the appearance pane", () => {
    renderDialog({ themeMode: "light" });

    fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    fireEvent.click(screen.getByRole("radio", { name: /Dark mode/i }));

    expect(screen.getByRole("radio", { name: /Dark mode/i })).toBeChecked();
  });

  it("loads MCP server statuses in the MCP servers tab", async () => {
    // Fresh response per call: the tab issues independent requests for the
    // server list and the persisted tool approvals, and a Response body can
    // only be consumed once.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/me/models")) {
        return createJsonResponse([]);
      }
      if (String(input).includes("/me/mcp-tool-approval-settings")) {
        return createJsonResponse({ settings: [] });
      }
      return createJsonResponse({
        servers: [
          {
            id: "notion",
            authentication_mode: "oauth2",
            connection_status: "NEEDS_AUTHENTICATION",
          },
          {
            id: "slack",
            authentication_mode: "forwarded",
            connection_status: "SUCCESS",
          },
          {
            id: "legacy",
            authentication_mode: "fixed",
            connection_status: "FAILURE",
          },
        ],
      });
    });

    renderDialog();

    fireEvent.click(screen.getByRole("tab", { name: "MCP & Apps" }));

    expect(
      await screen.findByText(
        "Authorization is required before this server can be used.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("notion")).toBeInTheDocument();
    expect(screen.getByText("slack")).toBeInTheDocument();
    expect(screen.getByText("legacy")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Authorize" }),
    ).toBeInTheDocument();
    expect(
      (await screen.findAllByTitle("Model Context Protocol")).length,
    ).toBeGreaterThan(0);
    // The status word is visible text on the row's caption line.
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Connection failed")).toBeInTheDocument();
  });

  it("starts OAuth in the current tab", async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, href: "http://localhost/" },
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (
          url === "/api/v1beta/me/mcp_servers" &&
          method === "GET" &&
          fetchMock.mock.calls.filter(
            ([calledUrl, calledInit]) =>
              String(calledUrl) === "/api/v1beta/me/mcp_servers" &&
              (calledInit?.method ?? "GET") === "GET",
          ).length === 1
        ) {
          return createJsonResponse({
            servers: [
              {
                id: "notion",
                authentication_mode: "oauth2",
                connection_status: "NEEDS_AUTHENTICATION",
              },
            ],
          });
        }

        if (url === "/api/v1beta/me/mcp_servers/notion/oauth/start") {
          return createJsonResponse({
            authorization_url: "https://auth.example.com/oauth/authorize",
          });
        }

        if (url === "/api/v1beta/me/mcp_servers" && method === "GET") {
          return createJsonResponse({
            servers: [
              {
                id: "notion",
                authentication_mode: "oauth2",
                connection_status: "SUCCESS",
              },
            ],
          });
        }

        throw new Error(`Unexpected request: ${method} ${url}`);
      });

    renderDialog();

    fireEvent.click(screen.getByRole("tab", { name: "MCP & Apps" }));
    await screen.findByRole("button", { name: "Authorize" });

    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1beta/me/mcp_servers/notion/oauth/start",
        expect.objectContaining({
          method: "POST",
        }),
      );
      expect(window.location.href).toBe(
        "https://auth.example.com/oauth/authorize",
      );
    });

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("disconnects an OAuth-backed MCP server", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url === "/api/v1beta/me/mcp_servers" && method === "GET") {
          return createJsonResponse({
            servers: [
              {
                id: "notion",
                authentication_mode: "oauth2",
                connection_status: "SUCCESS",
              },
            ],
          });
        }

        if (
          url === "/api/v1beta/me/mcp_servers/notion/oauth" &&
          method === "DELETE"
        ) {
          return createJsonResponse({
            connection_status: "NEEDS_AUTHENTICATION",
          });
        }

        throw new Error(`Unexpected request: ${method} ${url}`);
      });

    renderDialog();

    fireEvent.click(screen.getByRole("tab", { name: "MCP & Apps" }));
    await screen.findByRole("button", { name: "Disconnect" });

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1beta/me/mcp_servers/notion/oauth",
        expect.objectContaining({
          method: "DELETE",
        }),
      );
    });

    expect(
      await screen.findByText("Disconnected successfully."),
    ).toBeInTheDocument();
  });

  it("completes an OAuth callback after returning to the MCP servers tab", async () => {
    const onMcpOauthCallbackHandled = vi.fn();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url === "/api/v1beta/me/mcp_servers" && method === "GET") {
          return createJsonResponse({
            servers: [
              {
                id: "notion",
                authentication_mode: "oauth2",
                connection_status: "SUCCESS",
              },
            ],
          });
        }

        if (
          url ===
            "/api/v1beta/me/mcp_servers/notion/oauth/callback?code=oauth-code&state=oauth-state" &&
          method === "GET"
        ) {
          return createJsonResponse({
            connection_status: "SUCCESS",
          });
        }

        throw new Error(`Unexpected request: ${method} ${url}`);
      });

    renderDialog({
      initialTab: "serversTools",
      onMcpOauthCallbackHandled,
      pendingMcpOauthCallback: {
        code: "oauth-code",
        serverId: "notion",
        state: "oauth-state",
      },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1beta/me/mcp_servers/notion/oauth/callback?code=oauth-code&state=oauth-state",
        expect.objectContaining({
          method: "GET",
        }),
      );
    });

    expect(
      await screen.findByText(
        "Authorization complete. The server is ready to use.",
      ),
    ).toBeInTheDocument();
    expect(onMcpOauthCallbackHandled).toHaveBeenCalled();
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
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        if (String(input).includes("/me/models")) {
          return createJsonResponse([]);
        }
        return new Response(JSON.stringify({ archived_chat_count: 2 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

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
      .mockImplementation(async (input) =>
        String(input).includes("/me/models")
          ? createJsonResponse([])
          : createJsonResponse(userProfile),
      );

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
        preference_default_chat_provider: null,
        // Always sent explicitly, even while the start-screen section is
        // hidden: omitting either would let any save wipe the stored state.
        preference_starting_hub_assistant_id: null,
        preference_starting_assistant_cleared: false,
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: profileQuery({}).queryKey,
      });
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("saves the selected model as the user's default", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        if (String(input).includes("/me/models")) {
          return createJsonResponse([
            {
              chat_provider_id: "model-one",
              model_display_name: "Model One",
            },
            {
              chat_provider_id: "model-two",
              model_display_name: "Model Two",
            },
          ]);
        }
        return createJsonResponse(userProfile);
      });

    renderDialog();

    fireEvent.click(await screen.findByTitle("No default model"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Model Two" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const requestCall = fetchMock.mock.calls.find(
        ([url]) => url === "/api/v1beta/me/profile/preferences",
      );
      expect(JSON.parse(String(requestCall?.[1]?.body))).toEqual(
        expect.objectContaining({
          preference_default_chat_provider: "model-two",
        }),
      );
    });
  });

  describe("start screen preference", () => {
    // Only the fields the setting actually reads; the response is raw JSON
    // as far as the component is concerned.
    const hubAssistantVersions = [
      {
        hub_assistant_id: "hub-1",
        assistant: {
          name: "Docs Helper",
          description: "Answers documentation questions",
        },
      },
      {
        hub_assistant_id: "hub-2",
        assistant: { name: "Sales Coach" },
      },
    ];

    const mockFetchWithHub = () =>
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("/me/models")) {
          return createJsonResponse([]);
        }
        if (url.includes("/assistant-hub/config")) {
          return createJsonResponse({
            enabled: true,
            can_review: false,
            categories: [],
            default_share_with_whole_organization: false,
            rating_mode: "stars",
          });
        }
        if (url.includes("/assistant-hub/assistants")) {
          return createJsonResponse({ versions: hubAssistantVersions });
        }
        return createJsonResponse(userProfile);
      });

    const findPreferencesPut = (
      fetchMock: ReturnType<typeof mockFetchWithHub>,
    ) =>
      fetchMock.mock.calls.find(
        ([url]) => url === "/api/v1beta/me/profile/preferences",
      );

    it("saves an explicitly picked starting assistant by its hub id", async () => {
      const fetchMock = mockFetchWithHub();

      renderDialog();

      fireEvent.click(
        await screen.findByRole("radio", { name: /A specific assistant/ }),
      );
      fireEvent.click(await screen.findByTitle("Choose an assistant"));
      fireEvent.click(
        await screen.findByRole("menuitem", { name: /Docs Helper/ }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        const requestCall = findPreferencesPut(fetchMock);
        expect(requestCall).toBeDefined();
        expect(JSON.parse(String(requestCall?.[1]?.body))).toEqual(
          expect.objectContaining({
            preference_starting_hub_assistant_id: "hub-1",
            preference_starting_assistant_cleared: false,
          }),
        );
      });
    });

    it("saves an explicit clear (welcome screen) instead of just a null pick", async () => {
      const fetchMock = mockFetchWithHub();

      renderDialog({
        profile: {
          ...userProfile,
          preference_starting_hub_assistant_id: "hub-1",
        },
      });

      fireEvent.click(
        await screen.findByRole("radio", {
          name: /Always start on the welcome screen/,
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        const requestCall = findPreferencesPut(fetchMock);
        expect(requestCall).toBeDefined();
        expect(JSON.parse(String(requestCall?.[1]?.body))).toEqual(
          expect.objectContaining({
            preference_starting_hub_assistant_id: null,
            preference_starting_assistant_cleared: true,
          }),
        );
      });
    });

    it("returns from cleared to inherit with an explicit cleared=false", async () => {
      const fetchMock = mockFetchWithHub();

      renderDialog({
        profile: {
          ...userProfile,
          preference_starting_assistant_cleared: true,
        },
      });

      fireEvent.click(await screen.findByRole("radio", { name: /Automatic/ }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        const requestCall = findPreferencesPut(fetchMock);
        expect(requestCall).toBeDefined();
        expect(JSON.parse(String(requestCall?.[1]?.body))).toEqual(
          expect.objectContaining({
            preference_starting_hub_assistant_id: null,
            preference_starting_assistant_cleared: false,
          }),
        );
      });
    });

    it("preserves a stored pick when an unrelated preference is saved", async () => {
      const fetchMock = mockFetchWithHub();

      renderDialog({
        profile: {
          ...userProfile,
          preference_starting_hub_assistant_id: "hub-1",
        },
      });

      fireEvent.change(screen.getByLabelText("Nickname"), {
        target: { value: "Maximilian" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        const requestCall = findPreferencesPut(fetchMock);
        expect(requestCall).toBeDefined();
        expect(JSON.parse(String(requestCall?.[1]?.body))).toEqual(
          expect.objectContaining({
            preference_nickname: "Maximilian",
            preference_starting_hub_assistant_id: "hub-1",
            preference_starting_assistant_cleared: false,
          }),
        );
      });
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
