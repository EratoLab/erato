import { describe, expect, it, vi } from "vitest";

import { isAddMenuToolItem } from "../ChatInputAddMenu";
import {
  buildMcpToolsSection,
  MCP_TOOLS_OPEN_ITEM_ID,
  MCP_TOOLS_SECTION_ID,
  summarizeMcpConnectors,
} from "../mcpToolsSection";

import type { McpServerStatus } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const server = (
  id: string,
  displayName: string,
  connectionStatus: McpServerStatus["connection_status"] = "SUCCESS",
): McpServerStatus => ({
  id,
  display_name: displayName,
  connection_status: connectionStatus,
  authentication_mode: "oauth2",
});

const dynamics = server("dynamics", "Dynamics 365");
const notion = server("notion", "Notion");
const teams = server("teams", "Microsoft Teams");
const linear = server("linear", "Linear", "NEEDS_AUTHENTICATION");
const broken = server("kertos", "Kertos", "FAILURE");

const summary = (
  overrides: Partial<Parameters<typeof summarizeMcpConnectors>[0]> = {},
) =>
  summarizeMcpConnectors({
    servers: [dynamics, notion, teams],
    writeToolsEnabled: true,
    ...overrides,
  });

describe("buildMcpToolsSection", () => {
  it("is one row below the tools that opens the connectors dialog without the select delay", () => {
    const onOpen = vi.fn();
    const section = buildMcpToolsSection({
      servers: [dynamics],
      writeToolsEnabled: true,
      onOpen,
    });

    expect(section.id).toBe(MCP_TOOLS_SECTION_ID);
    expect(section.header).toBeUndefined();
    expect(section.placement).toBe("belowTools");
    expect(section.items).toHaveLength(1);
    const [row] = section.items;
    expect(row.id).toBe(MCP_TOOLS_OPEN_ITEM_ID);
    expect(row.label).toBe("Connectors…");
    if (isAddMenuToolItem(row)) {
      throw new Error("the connectors row is an action, not a toggle");
    }
    expect(row.closesImmediately).toBe(true);
    row.onSelect();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("carries the summary as its description", () => {
    const section = buildMcpToolsSection({
      servers: [dynamics, notion],
      disabledServerIds: ["notion"],
      writeToolsEnabled: false,
      onOpen: vi.fn(),
    });

    expect(section.items[0].description).toBe("Notion off · read only");
  });

  it("is disabled while the composer is locked", () => {
    const section = buildMcpToolsSection({
      servers: [dynamics],
      writeToolsEnabled: true,
      onOpen: vi.fn(),
      disabled: true,
    });

    expect(section.items[0].disabled).toBe(true);
  });
});

describe("summarizeMcpConnectors", () => {
  it("counts every connector as on when none is switched off", () => {
    expect(summary()).toBe("All 3 on");
  });

  it("does not say 'All' for a single connector", () => {
    expect(summary({ servers: [dynamics] })).toBe("1 on");
  });

  it("names up to two switched-off connectors by their display name", () => {
    expect(summary({ disabledServerIds: ["dynamics"] })).toBe(
      "Dynamics 365 off",
    );
    expect(summary({ disabledServerIds: ["dynamics", "notion"] })).toBe(
      "Dynamics 365, Notion off",
    );
  });

  it("counts instead of naming when more than two are switched off", () => {
    const servers = [dynamics, notion, teams, server("granola", "Granola")];
    expect(
      summary({
        servers,
        disabledServerIds: ["dynamics", "notion", "teams"],
      }),
    ).toBe("1 on, 3 off");
  });

  it("says how many connectors still wait for the user to connect", () => {
    expect(summary({ servers: [dynamics, notion, linear] })).toBe(
      "All 2 on · 1 to connect",
    );
  });

  it("counts a connector that failed to connect as on, since it was not switched off", () => {
    expect(summary({ servers: [dynamics, broken] })).toBe("All 2 on");
  });

  it("ignores a switch-off recorded for a connector that waits to be connected", () => {
    expect(
      summary({ servers: [dynamics, linear], disabledServerIds: ["linear"] }),
    ).toBe("1 on · 1 to connect");
  });

  it("ends with 'read only' when changes are off", () => {
    expect(summary({ writeToolsEnabled: false })).toBe("All 3 on · read only");
  });

  it("only speaks of connecting when no connector is connected yet", () => {
    expect(summary({ servers: [linear] })).toBe("1 to connect");
  });
});
