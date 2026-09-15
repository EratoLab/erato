import { describe, expect, it } from "vitest";

import { groupMcpTools } from "./mcpToolGroups";

import type { McpServerTool } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const tool = (
  name: string,
  annotations: Partial<McpServerTool["annotations"]>,
): McpServerTool => ({
  name,
  title: name,
  description: null,
  description_truncated: false,
  annotations: {
    read_only_hint: false,
    destructive_hint: false,
    idempotent_hint: false,
    open_world_hint: false,
    annotated: true,
    ...annotations,
  },
  policy: "auto",
  user_decision: "none",
  effective: "allow",
  is_wait_tool: false,
});

describe("groupMcpTools", () => {
  it("puts read-only tools first and everything else, unannotated included, in the write group", () => {
    const groups = groupMcpTools([
      tool("copy_file", { read_only_hint: false }),
      tool("get_file", { read_only_hint: true }),
      tool("mystery", { read_only_hint: false, annotated: false }),
      tool("list_files", { read_only_hint: true, idempotent_hint: true }),
    ]);

    expect(
      groups.map(({ key, tools }) => [key, tools.map((tool) => tool.name)]),
    ).toEqual([
      ["readOnly", ["get_file", "list_files"]],
      ["write", ["copy_file", "mystery"]],
    ]);
  });

  it("leaves out a group with no tools", () => {
    expect(
      groupMcpTools([tool("get_file", { read_only_hint: true })]).map(
        ({ key, tools }) => [key, tools.length],
      ),
    ).toEqual([["readOnly", 1]]);
    expect(groupMcpTools([])).toEqual([]);
  });
});
