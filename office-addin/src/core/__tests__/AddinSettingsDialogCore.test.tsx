import { i18n } from "@lingui/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddinSettingsDialogCore } from "../AddinSettingsDialogCore";

import type { TabRailProps } from "@erato/frontend/library";

const featureFlags = vi.hoisted(() => ({ audio: false, mcpServers: false }));
const authorizeInBrowser = vi.hoisted(() => vi.fn());

vi.mock("@erato/frontend/library", async () => {
  // The core zone rule reads any `src/` import as host behavior reaching a
  // host-neutral file; a test-only stub set is neither.
  // eslint-disable-next-line import/no-restricted-paths
  const mock = await import("../../test/helpers/eratoLibraryMock");

  return mock.createEratoLibraryMock({
    AppearanceTabContent: () => <div data-testid="appearance-settings" />,
    TextSizeSetting: () => <div data-testid="text-size-settings" />,
    AudioInputTabContent: () => null,
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
    // Renders real tabs from the options: the assertions below resolve tabs
    // by role and name and panels through the tab ids, so a null stub would
    // turn them into false failures and a permissive one into false passes.
    TabRail: ({
      options,
      value,
      onChange,
      "aria-label": ariaLabel,
    }: TabRailProps<string>) => (
      <div role="tablist" aria-label={ariaLabel}>
        {options.map((option) => (
          <button
            key={option.value}
            id={option.id}
            type="button"
            role="tab"
            aria-selected={value === option.value ? "true" : "false"}
            aria-controls={option.panelId}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    ),
    useFeatureConfig: () => ({
      audioTranscription: { enabled: featureFlags.audio },
      audioDictation: { enabled: false },
      audioConversational: { enabled: false },
      userPreferences: {
        desktopSidecarTabEnabled: false,
        mcpServersTabEnabled: featureFlags.mcpServers,
      },
    }),
  });
});
vi.mock("../UserSettingsTabContent", () => ({
  UserSettingsTabContent: () => <div data-testid="user-settings" />,
}));

const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent);

describe("AddinSettingsDialogCore", () => {
  beforeEach(() => {
    authorizeInBrowser.mockClear();
    i18n.activate("en");
    featureFlags.audio = false;
    featureFlags.mcpServers = false;
  });
  afterEach(cleanup);

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
    // A host with client actions but no host behaviour to configure (Word)
    // must be able to reach the shared "MCP & Apps" pane without paying for
    // an empty tab of its own.
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
});
