import { describe, expect, it } from "vitest";

import {
  countDisabledMcpTools,
  isExactMcpToolPattern,
  isMcpToolDisabled,
  mcpToolCoveringPattern,
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

  it("tells an exact entry from the wildcard shapes", () => {
    expect(isExactMcpToolPattern("linear/create_issue")).toBe(true);
    expect(isExactMcpToolPattern("files/read/nested")).toBe(true);
    expect(isExactMcpToolPattern("*")).toBe(false);
    expect(isExactMcpToolPattern("linear")).toBe(false);
    expect(isExactMcpToolPattern("linear/*")).toBe(false);
    expect(isExactMcpToolPattern("files/read/*")).toBe(false);
    expect(isExactMcpToolPattern("linear/")).toBe(false);
  });

  // The same grammar the backend subtracts with, so the switches never
  // show a tool as on that the generation withholds.
  it("matches a tool by exact entry, server wildcard, bare server or the catch-all", () => {
    expect(
      isMcpToolDisabled(["linear/create_issue"], "linear", "create_issue"),
    ).toBe(true);
    expect(
      isMcpToolDisabled(["linear/create_issue"], "linear", "get_issue"),
    ).toBe(false);
    expect(
      isMcpToolDisabled(["linear/create_issue"], "github", "create_issue"),
    ).toBe(false);

    expect(isMcpToolDisabled(["linear/*"], "linear", "get_issue")).toBe(true);
    expect(isMcpToolDisabled(["linear/*"], "linear-eu", "get_issue")).toBe(
      false,
    );
    expect(isMcpToolDisabled(["linear"], "linear", "get_issue")).toBe(true);
    expect(isMcpToolDisabled(["linear"], "linear-eu", "get_issue")).toBe(false);
    expect(isMcpToolDisabled(["*"], "github", "anything")).toBe(true);
  });

  // A prefix may reach into a slashed tool name, as the backend's does.
  it("matches a wildcard below a slashed tool name prefix", () => {
    expect(isMcpToolDisabled(["files/read/*"], "files", "read/nested")).toBe(
      true,
    );
    expect(isMcpToolDisabled(["files/read/*"], "files", "read")).toBe(false);
    expect(isMcpToolDisabled(["files/read/*"], "files", "write/nested")).toBe(
      false,
    );
  });

  it("names the wildcard entry that keeps a tool off beyond its exact entry", () => {
    expect(
      mcpToolCoveringPattern(["files/read_file"], "files", "read_file"),
    ).toBeNull();
    expect(mcpToolCoveringPattern(["files/*"], "files", "read_file")).toBe(
      "files/*",
    );
    // Both entries present: the exact one is removable, the wildcard is not.
    expect(
      mcpToolCoveringPattern(
        ["files/read_file", "files/*"],
        "files",
        "read_file",
      ),
    ).toBe("files/*");
    expect(mcpToolCoveringPattern(["files"], "files", "read_file")).toBe(
      "files",
    );
    expect(mcpToolCoveringPattern(["*"], "files", "read_file")).toBe("*");
    expect(
      mcpToolCoveringPattern(["files/*"], "linear", "get_issue"),
    ).toBeNull();
  });

  it("counts a server's exact entries by exact server id", () => {
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

  // A wildcard has no number without the roster: an entry covering the
  // server as a whole is "all", one reaching part-way in is "some".
  it("reports a wildcard as all or some instead of counting it as a tool", () => {
    expect(countDisabledMcpTools(["linear/*"], "linear")).toBe("all");
    expect(countDisabledMcpTools(["linear"], "linear")).toBe("all");
    expect(countDisabledMcpTools(["*"], "linear")).toBe("all");
    expect(
      countDisabledMcpTools(["linear/create_issue", "linear/*"], "linear"),
    ).toBe("all");
    expect(countDisabledMcpTools(["files/read/*"], "files")).toBe("some");
    expect(
      countDisabledMcpTools(["files/write_file", "files/read/*"], "files"),
    ).toBe("some");
    expect(countDisabledMcpTools(["linear/*"], "linear-eu")).toBe(0);
    expect(countDisabledMcpTools(["linear"], "linear-eu")).toBe(0);
  });
});
