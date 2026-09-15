import { describe, expect, it, vi } from "vitest";

import { isAddMenuToolItem } from "../ChatInputAddMenu";
import {
  buildMcpToolsSection,
  mcpToolsServerItemId,
  MCP_TOOLS_BROWSE_ITEM_ID,
  MCP_TOOLS_SECTION_ID,
  MCP_TOOLS_WRITE_TOGGLE_ITEM_ID,
} from "../mcpToolsSection";

import type { McpServerStatus } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const server = (
  id: string,
  connectionStatus: McpServerStatus["connection_status"] = "SUCCESS",
): McpServerStatus => ({
  id,
  connection_status: connectionStatus,
  authentication_mode: "oauth2",
});

const build = (
  overrides: Partial<Parameters<typeof buildMcpToolsSection>[0]> = {},
) =>
  buildMcpToolsSection({
    writeToolsEnabled: true,
    onToggleWriteTools: vi.fn(),
    onBrowse: vi.fn(),
    ...overrides,
  });

const toggleOf = (section: ReturnType<typeof build>) => {
  const item = section.items.find(
    (candidate) => candidate.id === MCP_TOOLS_WRITE_TOGGLE_ITEM_ID,
  );
  if (!item || !isAddMenuToolItem(item)) {
    throw new Error("write toggle row missing");
  }
  return item;
};

const browseOf = (section: ReturnType<typeof build>) => {
  const item = section.items.find(
    (candidate) => candidate.id === MCP_TOOLS_BROWSE_ITEM_ID,
  );
  if (!item || isAddMenuToolItem(item)) {
    throw new Error("browse row missing");
  }
  return item;
};

describe("buildMcpToolsSection", () => {
  it("groups the write switch and the browse row under Connectors below the tools", () => {
    const section = build();

    expect(section.id).toBe(MCP_TOOLS_SECTION_ID);
    expect(section.header).toBe("Connectors");
    expect(section.placement).toBe("belowTools");
    expect(section.items.map((item) => item.id)).toEqual([
      MCP_TOOLS_WRITE_TOGGLE_ITEM_ID,
      MCP_TOOLS_BROWSE_ITEM_ID,
    ]);
  });

  it("shows the chat's write setting as the toggle state and flips it on toggle", () => {
    const onToggleWriteTools = vi.fn();

    expect(toggleOf(build({ writeToolsEnabled: true })).checked).toBe(true);

    const toggle = toggleOf(
      build({ writeToolsEnabled: false, onToggleWriteTools }),
    );
    expect(toggle.checked).toBe(false);
    expect(toggle.label).toBe("Allow write operations");
    toggle.onToggle();
    expect(onToggleWriteTools).toHaveBeenCalledTimes(1);
  });

  // An unannotated tool is not read-only under protocol defaults, so the
  // copy must credit the server's marking rather than promise "read-only".
  it("describes the off state as tools the server marks read-only", () => {
    expect(toggleOf(build()).description).toBe(
      "Off, only tools the server marks read-only are offered.",
    );
  });

  it("names the paused host actions where the host proposes them", () => {
    expect(toggleOf(build({ pausesHostActions: true })).description).toBe(
      "Off, only tools the server marks read-only are offered. Also pauses Outlook actions like Reply and Send.",
    );
  });

  // The row opens a dialog, which must claim focus before the menu returns
  // it to the trigger.
  it("opens the browser without the select delay", () => {
    const onBrowse = vi.fn();
    const browse = browseOf(build({ onBrowse }));

    expect(browse.label).toBe("Browse tools…");
    expect(browse.closesImmediately).toBe(true);
    browse.onSelect();
    expect(onBrowse).toHaveBeenCalledTimes(1);
  });

  it("disables every row while the composer is locked", () => {
    const section = build({ disabled: true });

    expect(section.items.every((item) => item.disabled)).toBe(true);
  });

  describe("server rows", () => {
    const itemOf = (section: ReturnType<typeof build>, serverId: string) => {
      const item = section.items.find(
        (candidate) => candidate.id === mcpToolsServerItemId(serverId),
      );
      if (!item) {
        throw new Error(`row for ${serverId} missing`);
      }
      return item;
    };

    it("lists one switch per server ahead of the write switch, ticked unless switched off", () => {
      const section = build({
        servers: [server("linear"), server("github")],
        disabledServerIds: ["github"],
        onToggleServer: vi.fn(),
      });

      expect(section.items.map((item) => item.id)).toEqual([
        "server-linear",
        "server-github",
        MCP_TOOLS_WRITE_TOGGLE_ITEM_ID,
        MCP_TOOLS_BROWSE_ITEM_ID,
      ]);
      const linear = itemOf(section, "linear");
      const github = itemOf(section, "github");
      expect(isAddMenuToolItem(linear) && linear.checked).toBe(true);
      expect(isAddMenuToolItem(github) && github.checked).toBe(false);
      expect(linear.label).toBe("linear");
      expect(isAddMenuToolItem(linear) && linear.description).toBeUndefined();
    });

    it("flips the server the row belongs to", () => {
      const onToggleServer = vi.fn();
      const section = build({
        servers: [server("linear"), server("github")],
        onToggleServer,
      });

      const github = itemOf(section, "github");
      if (!isAddMenuToolItem(github)) {
        throw new Error("server row is not a switch");
      }
      github.onToggle();
      expect(onToggleServer).toHaveBeenCalledWith("github");
    });

    // Nothing to switch off before the user connects; the row is the way
    // to connect instead, and it opens a dialog like the browse row.
    it("offers a connect row instead of a switch for a server awaiting authorization", () => {
      const onConnect = vi.fn();
      const onToggleServer = vi.fn();
      const section = build({
        servers: [server("jira", "NEEDS_AUTHENTICATION")],
        onToggleServer,
        onConnect,
      });

      const jira = itemOf(section, "jira");
      expect(isAddMenuToolItem(jira)).toBe(false);
      if (isAddMenuToolItem(jira)) {
        throw new Error("connect row is a switch");
      }
      expect(jira.description).toBe("Needs authentication");
      expect(jira.closesImmediately).toBe(true);
      jira.onSelect();
      expect(onConnect).toHaveBeenCalledTimes(1);
      expect(onToggleServer).not.toHaveBeenCalled();
    });

    it("keeps a failed server's switch live and says why it is idle", () => {
      const onToggleServer = vi.fn();
      const section = build({
        servers: [server("wiki", "FAILURE")],
        disabledServerIds: ["wiki"],
        onToggleServer,
      });

      const wiki = itemOf(section, "wiki");
      if (!isAddMenuToolItem(wiki)) {
        throw new Error("server row is not a switch");
      }
      expect(wiki.checked).toBe(false);
      expect(wiki.disabled).toBe(false);
      expect(wiki.description).toBe(
        "The server is configured, but the backend could not connect to it.",
      );
      wiki.onToggle();
      expect(onToggleServer).toHaveBeenCalledWith("wiki");
    });

    it("locks only the switches while the chat's list is not known yet", () => {
      const section = build({
        servers: [server("linear"), server("jira", "NEEDS_AUTHENTICATION")],
        onToggleServer: vi.fn(),
        onConnect: vi.fn(),
        serverSwitchesLocked: true,
      });

      expect(itemOf(section, "linear").disabled).toBe(true);
      expect(itemOf(section, "jira").disabled).toBe(false);
      expect(
        section.items
          .filter((item) => !item.id.startsWith("server-"))
          .every((item) => !item.disabled),
      ).toBe(true);
    });

    it("locks the server rows with the rest of the group", () => {
      const section = build({
        servers: [server("linear"), server("jira", "NEEDS_AUTHENTICATION")],
        onToggleServer: vi.fn(),
        onConnect: vi.fn(),
        disabled: true,
      });

      expect(section.items.every((item) => item.disabled)).toBe(true);
    });
  });
});
