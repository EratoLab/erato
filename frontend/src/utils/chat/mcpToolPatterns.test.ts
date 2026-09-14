import { describe, expect, it } from "vitest";

import {
  countDisabledMcpTools,
  isMcpToolDisabled,
  mcpToolPattern,
  parseMcpToolPattern,
} from "./mcpToolPatterns";

describe("mcpToolPatterns", () => {
  it("spells a tool as server/tool and reads it back", () => {
    expect(mcpToolPattern("linear", "create_issue")).toBe(
      "linear/create_issue",
    );
    expect(parseMcpToolPattern("linear/create_issue")).toEqual({
      serverId: "linear",
      toolName: "create_issue",
    });
  });

  // A tool name may itself contain a slash; only the first one separates.
  it("splits on the first slash only and rejects a pattern without both halves", () => {
    expect(parseMcpToolPattern("files/read/nested")).toEqual({
      serverId: "files",
      toolName: "read/nested",
    });
    expect(parseMcpToolPattern("linear")).toBeNull();
    expect(parseMcpToolPattern("linear/")).toBeNull();
    expect(parseMcpToolPattern("/create_issue")).toBeNull();
  });

  it("matches a tool by its exact entry only", () => {
    const patterns = ["linear/create_issue", "linear/*"];

    expect(isMcpToolDisabled(patterns, "linear", "create_issue")).toBe(true);
    expect(isMcpToolDisabled(patterns, "linear", "get_issue")).toBe(false);
    expect(isMcpToolDisabled(patterns, "github", "create_issue")).toBe(false);
  });

  it("counts a server's entries by exact server id", () => {
    const patterns = [
      "linear/create_issue",
      "linear/delete_issue",
      "linear-eu/create_issue",
      "github/create_issue",
      "malformed",
    ];

    expect(countDisabledMcpTools(patterns, "linear")).toBe(2);
    expect(countDisabledMcpTools(patterns, "github")).toBe(1);
    expect(countDisabledMcpTools(patterns, "jira")).toBe(0);
  });
});
