import { i18n } from "@lingui/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter, useHref, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddinSettingsDialogCore } from "../AddinSettingsDialogCore";

import type * as EratoLibrary from "@erato/frontend/library";
import type React from "react";
import type { ReactNode } from "react";

const featureFlags = vi.hoisted(() => ({
  audio: false,
  mcpServers: false,
  disclaimers: false,
}));
const authorizeInBrowser = vi.hoisted(() => vi.fn());
// The real settings-pages hook reads the pane width; the task pane is wide
// here unless a test narrows it.
const pane = { narrow: false };

vi.mock("@erato/frontend/library", async () => {
  // The core zone rule reads any `src/` import as host behavior reaching a
  // host-neutral file; a test-only stub set is neither.
  // eslint-disable-next-line import/no-restricted-paths
  const mock = await import("../../test/helpers/eratoLibraryMock");
  const {
    SettingsPageList,
    TabRail,
    isDisclaimersSettingsLink,
    settingsClosedLocation,
    useSettingsPages,
  } = await vi.importActual<typeof EratoLibrary>("@erato/frontend/library");

  return mock.createEratoLibraryMock({
    AppearanceTabContent: () => <div data-testid="appearance-settings" />,
    TextSizeSetting: () => <div data-testid="text-size-settings" />,
    AudioInputTabContent: () => <div data-testid="microphone-controls" />,
    DisclaimersPane: () => <h2>Organization AI policy</h2>,
    ModalBase: ({
      children,
      isOpen,
      onClose,
      title,
      back,
      placement,
    }: {
      children: ReactNode;
      isOpen: boolean;
      onClose: () => void;
      title?: string;
      back?: {
        label: string;
        onBack: () => void;
        ref?: React.Ref<HTMLButtonElement>;
      };
      placement?: string;
    }) =>
      isOpen ? (
        <div role="dialog" aria-label={title} data-placement={placement}>
          {back ? (
            <button ref={back.ref} onClick={back.onBack}>
              {back.label}
            </button>
          ) : null}
          <button onClick={onClose}>Close</button>
          {children}
        </div>
      ) : null,
    isDisclaimersSettingsLink,
    settingsClosedLocation,
    useMcpBrowserAuthorization: () => authorizeInBrowser,
    ServersToolsPane: ({
      mcp,
    }: {
      mcp?: { onAuthorize: (serverId: string) => void };
    }) =>
      mcp ? (
        <button onClick={() => mcp.onAuthorize("sales")}>
          Authorize in browser
        </button>
      ) : null,
    SettingsPageList,
    TabRail,
    useSettingsPages,
    useFeatureConfig: () => ({
      audioTranscription: { enabled: featureFlags.audio },
      audioDictation: { enabled: false },
      audioConversational: { enabled: false },
      userPreferences: {
        desktopSidecarTabEnabled: false,
        mcpServersTabEnabled: featureFlags.mcpServers,
        disclaimersTabEnabled: featureFlags.disclaimers,
      },
    }),
  });
});
vi.mock("../UserSettingsTabContent", () => ({
  UserSettingsTabContent: () => <div data-testid="user-settings" />,
}));

const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent);

function LocationProbe() {
  const href = useHref(useLocation());
  return <output>{href}</output>;
}

describe("AddinSettingsDialogCore", () => {
  beforeEach(() => {
    pane.narrow = false;
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: pane.narrow && query === "(max-width: 639.98px)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    authorizeInBrowser.mockClear();
    i18n.activate("en");
    featureFlags.audio = false;
    featureFlags.mcpServers = false;
    featureFlags.disclaimers = false;
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens the last tab from a task-pane link and cleans the URL on close", () => {
    featureFlags.disclaimers = true;
    render(
      <MemoryRouter
        basename="/office-addin"
        initialEntries={[
          "/office-addin/word?keep=value&preferencesDialog=open&preferencesTab=disclaimers#footer",
        ]}
      >
        <AddinSettingsDialogCore
          isOpen={false}
          onClose={() => {}}
          supportsDisclaimers
          hostContribution={{ tabLabel: "Word", content: <p>Word options</p> }}
        />
        <LocationProbe />
      </MemoryRouter>,
    );

    const tab = screen.getByRole("tab", { name: "Disclaimers" });
    expect(tabNames().slice(-2)).toEqual(["Word", "Disclaimers"]);
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Disclaimers" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Organization AI policy" }),
    ).toBeVisible();
    tab.focus();
    fireEvent.keyDown(tab, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Word" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByText("/office-addin/word?keep=value#footer"),
    ).toBeInTheDocument();
  });

  it("opens Appearance when the linked Disclaimers tab is disabled", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/word?preferencesDialog=open&preferencesTab=disclaimers",
        ]}
      >
        <AddinSettingsDialogCore
          isOpen={false}
          onClose={() => {}}
          supportsDisclaimers
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("tab", { name: "Disclaimers" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Appearance" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("keeps the unsupported explanation available when audio features are disabled", () => {
    render(
      <AddinSettingsDialogCore
        isOpen
        onClose={() => {}}
        audioInputSupported={false}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Microphone" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Audio input is not supported on this platform",
    );
    expect(screen.queryByTestId("microphone-controls")).toBeNull();
  });

  it("shows microphone controls without the unsupported indicator on supported hosts", () => {
    featureFlags.audio = true;
    render(
      <AddinSettingsDialogCore isOpen onClose={() => {}} audioInputSupported />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Microphone" }));
    expect(screen.getByTestId("microphone-controls")).toBeVisible();
    expect(
      screen.queryByText("Audio input is not supported on this platform"),
    ).toBeNull();
  });

  it("opens on the tab it is asked to open on", () => {
    const hostContribution = {
      tabLabel: "Word",
      content: <div data-testid="host-settings" />,
    };
    const { rerender } = render(
      <AddinSettingsDialogCore
        isOpen={false}
        onClose={() => {}}
        hostContribution={hostContribution}
        openTab="host"
      />,
    );
    rerender(
      <AddinSettingsDialogCore
        isOpen
        onClose={() => {}}
        hostContribution={hostContribution}
        openTab="host"
      />,
    );

    expect(screen.getByRole("tab", { name: "Word" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("host-settings")).toBeVisible();
  });

  it("hands the selected server to the shared browser authorization controller", () => {
    featureFlags.mcpServers = true;
    render(<AddinSettingsDialogCore isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "MCP & Apps" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Authorize in browser" }),
    );
    expect(authorizeInBrowser).toHaveBeenCalledWith("sales");
  });

  it("shows generic settings without an empty Outlook behavior tab", () => {
    render(<AddinSettingsDialogCore isOpen={true} onClose={() => {}} />);

    expect(screen.getByRole("tab", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByTestId("appearance-settings")).toBeInTheDocument();
    expect(screen.getByTestId("text-size-settings")).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "User settings" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Outlook" })).toBeNull();
    expect(screen.queryByText("Outlook behavior")).toBeNull();
    expect(screen.queryByRole("tab", { name: "MCP & Apps" })).toBeNull();
  });

  it("lists the four generic tabs in order when every flag is on", () => {
    featureFlags.audio = true;
    featureFlags.mcpServers = true;
    render(<AddinSettingsDialogCore isOpen={true} onClose={() => {}} />);

    expect(
      screen.getByRole("tablist", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(tabNames()).toEqual([
      "Appearance",
      "User settings",
      "Microphone",
      "MCP & Apps",
    ]);
    expect(screen.queryByRole("tab", { name: "Outlook" })).toBeNull();
  });

  it("adds the host tab last and links it both ways to its panel", () => {
    featureFlags.audio = true;
    render(
      <AddinSettingsDialogCore
        isOpen={true}
        onClose={() => {}}
        hostContribution={{
          tabLabel: "Outlook",
          heading: "Outlook behavior",
          description: "How mail maps to chats.",
          content: <div data-testid="host-content" />,
          serversToolsEntities: <div data-testid="host-entities" />,
        }}
      />,
    );

    expect(tabNames()).toEqual([
      "Appearance",
      "User settings",
      "Microphone",
      "MCP & Apps",
      "Outlook",
    ]);

    const appearanceTab = screen.getByRole("tab", { name: "Appearance" });
    const hostTab = screen.getByRole("tab", { name: "Outlook" });
    expect(appearanceTab).toHaveAttribute("aria-selected", "true");
    expect(hostTab).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByRole("tabpanel", { name: "Outlook" })).toBeNull();

    fireEvent.click(hostTab);

    expect(hostTab).toHaveAttribute("aria-selected", "true");
    expect(appearanceTab).toHaveAttribute("aria-selected", "false");
    // The panel names itself through the tab id and the tab claims the
    // panel through its id, so both halves of the wiring are exercised.
    const hostPanel = screen.getByRole("tabpanel", { name: "Outlook" });
    expect(hostTab).toHaveAttribute("aria-controls", hostPanel.id);
    expect(hostPanel).toContainElement(screen.getByTestId("host-content"));
    expect(screen.getByText("Outlook behavior")).toBeInTheDocument();
    expect(screen.queryByRole("tabpanel", { name: "Appearance" })).toBeNull();
  });

  it("spawns the shared pane but NO host tab for an entities-only contribution", () => {
    render(
      <AddinSettingsDialogCore
        isOpen={true}
        onClose={() => {}}
        hostContribution={{
          serversToolsEntities: <div data-testid="host-entities" />,
        }}
      />,
    );

    expect(tabNames()).toEqual(["Appearance", "User settings", "MCP & Apps"]);
  });

  describe("in a narrow pane", () => {
    beforeEach(() => {
      pane.narrow = true;
    });

    it("lists the tabs as pages and opens one with a way back", () => {
      featureFlags.mcpServers = true;
      render(
        <AddinSettingsDialogCore
          isOpen
          onClose={() => {}}
          hostContribution={{ tabLabel: "Word", content: <p>Word options</p> }}
        />,
      );

      const dialog = screen.getByRole("dialog", { name: "Settings" });
      expect(dialog).toHaveAttribute("data-placement", "fullscreen");
      expect(screen.queryByRole("tablist")).toBeNull();
      const list = screen.getByRole("navigation", { name: "Settings" });
      expect(
        within(list)
          .getAllByRole("button")
          .map((row) => row.textContent),
      ).toEqual(["Appearance", "User settings", "MCP & Apps", "Word"]);

      fireEvent.click(within(list).getByRole("button", { name: "Word" }));

      expect(screen.getByRole("dialog", { name: "Word" })).toBeVisible();
      expect(screen.getByText("Word options")).toBeVisible();
      expect(screen.getByTestId("appearance-settings")).not.toBeVisible();
      const back = screen.getByRole("button", { name: "Back to Settings" });
      expect(back).toHaveFocus();

      fireEvent.click(back);

      expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Word" })).toHaveFocus();
      expect(screen.getByText("Word options")).not.toBeVisible();
    });

    it("opens on the tab it is asked for", () => {
      render(
        <AddinSettingsDialogCore isOpen onClose={() => {}} openTab="user" />,
      );

      expect(
        screen.getByRole("dialog", { name: "User settings" }),
      ).toBeVisible();
      expect(screen.getByTestId("user-settings")).toBeVisible();
      expect(screen.queryByRole("navigation")).toBeNull();
    });
  });
});
