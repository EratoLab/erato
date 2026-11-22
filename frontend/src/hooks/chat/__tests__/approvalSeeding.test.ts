import { describe, expect, it } from "vitest";

import { seedDecisionParts } from "../approvalSeeding";
import { applyToolUseUpdate } from "../handlers/toolUsePartHelpers";

import type { MessageSubmitStreamingResponseToolCallUpdate } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const item = {
  approval_id: "call-1",
  tool_call_id: "call-1",
  tool_name: "cancel_reminder",
  input: { reminder_id: "r-1" },
};

const kinds = (parts: ReturnType<typeof seedDecisionParts>) =>
  parts.map((part) => [
    part.content_type,
    "status" in part ? part.status : undefined,
  ]);

describe("seedDecisionParts", () => {
  it("seeds an approved built-in call's decision only: its row comes with the dispatch", () => {
    expect(
      kinds(
        seedDecisionParts(
          [{ item, decision: "approve" }],
          "builtin_tool",
          "2026-11-09T10:00:00Z",
        ),
      ),
    ).toEqual([["tool_approval", undefined]]);
  });

  it("seeds a denied built-in call as a failed call", () => {
    expect(
      kinds(
        seedDecisionParts(
          [{ item, decision: "reject" }],
          "builtin_tool",
          "2026-11-09T10:00:00Z",
        ),
      ),
    ).toEqual([
      ["tool_rejection", undefined],
      ["tool_use", "error"],
    ]);
  });

  it("hands an approved MCP call's result, with its view, to the call it seeded", () => {
    const view = { server_id: "apps", uri: "ui://mock/counter" };
    const seeded = seedDecisionParts(
      [{ item, decision: "approve" }],
      "mcp_tool",
      "2026-11-09T10:00:00Z",
    );
    expect(kinds(seeded)).toEqual([
      ["tool_approval", undefined],
      ["tool_use", "in_progress"],
    ]);

    // The continuation's update for the call, after the decision it seeded.
    const settled = applyToolUseUpdate(seeded, {
      message_id: "message-1",
      content_index: 1,
      tool_call_id: item.tool_call_id,
      tool_name: item.tool_name,
      status: "success",
      output: "Counter started at 41.",
      result_details: { view },
    } as unknown as MessageSubmitStreamingResponseToolCallUpdate);

    expect(kinds(settled)).toEqual([
      ["tool_approval", undefined],
      ["tool_use", "success"],
    ]);
    expect(settled[1]).toMatchObject({
      tool_call_id: item.tool_call_id,
      input: item.input,
      result_details: { view },
    });
  });

  it("seeds a change request as a call not run, with the reason and the words", () => {
    const parts = seedDecisionParts(
      [{ item, decision: "request_change", changeRequest: "nimm den 22." }],
      "mcp_tool",
      "2026-11-09T10:00:00Z",
    );
    expect(kinds(parts)).toEqual([
      ["tool_rejection", undefined],
      ["tool_use", "error"],
    ]);
    expect(parts[0]).toMatchObject({
      reason: "change_requested",
      change_request: "nimm den 22.",
      never_allow: false,
    });
  });

  it("a plain denial carries no reason and no words", () => {
    const [part] = seedDecisionParts(
      [{ item, decision: "reject" }],
      "mcp_tool",
      "2026-11-09T10:00:00Z",
    );
    expect(part).toMatchObject({ reason: null });
    expect(part).not.toHaveProperty("change_request");
  });

  it("seeds a call the model made by a qualified name as the server writes it", () => {
    const display = {
      title: "Search records",
      description: "Searches the records.",
      description_truncated: false,
      server_name: "CRM EU",
      tool_name: "search",
    };
    for (const decision of ["approve", "reject"] as const) {
      const [, row] = seedDecisionParts(
        [
          {
            item: {
              approval_id: "call-2",
              tool_call_id: "call-2",
              tool_name: "search",
              called_as: "crm_eu__search",
              display,
              input: { query: "invoices" },
            },
            decision,
          },
        ],
        "mcp_tool",
        "2026-11-09T10:00:00Z",
      );
      expect(row).toMatchObject({
        content_type: "tool_use",
        tool_name: "crm_eu__search",
        display: {
          title: "Search records",
          server_name: "CRM EU",
          tool_name: "search",
        },
      });
      expect(
        (row as { display?: { description?: string } }).display?.description,
      ).toBeUndefined();
    }
  });
});
