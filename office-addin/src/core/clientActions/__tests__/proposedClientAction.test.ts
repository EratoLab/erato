import { describe, it, expect } from "vitest";

import {
  CLIENT_ACTION_TOOL_NAME,
  extractProposedClientAction as extractProposedClientActionFor,
} from "../proposedClientAction";

import type { ContentPart } from "@erato/frontend/library";

/**
 * A stand-in host registry. The core fence bans importing a host module, so
 * these tests bind the validator to a local type guard over the same three
 * action ids the Outlook build implements — the shape the binding under test
 * is generic over, not Outlook's registry itself.
 */
const IMPLEMENTED = [
  "outlook.reply",
  "outlook.reply_all",
  "outlook.create_appointment",
] as const;

type TestAction = (typeof IMPLEMENTED)[number];

function isImplementedAction(action: string): action is TestAction {
  return (IMPLEMENTED as readonly string[]).includes(action);
}

function extractProposedClientAction(
  content: ContentPart[] | undefined,
  allowedActions: readonly string[],
): TestAction | undefined {
  return extractProposedClientActionFor(
    content,
    allowedActions,
    isImplementedAction,
  );
}

const ALLOWED = ["outlook.reply", "outlook.reply_all"];

function toolUsePart(overrides: Record<string, unknown> = {}): ContentPart {
  return {
    content_type: "tool_use",
    tool_call_id: "call-1",
    tool_name: CLIENT_ACTION_TOOL_NAME,
    status: "success",
    input: { action: "outlook.reply_all" },
    output: { status: "proposed", action: "outlook.reply_all" },
    ...overrides,
  } as unknown as ContentPart;
}

describe("extractProposedClientAction", () => {
  it("extracts a valid successful proposal", () => {
    expect(extractProposedClientAction([toolUsePart()], ALLOWED)).toBe(
      "outlook.reply_all",
    );
  });

  it("ignores other tools and non-tool parts", () => {
    const parts: ContentPart[] = [
      { content_type: "text", text: "use reply_all please" },
      toolUsePart({ tool_name: "some_mcp_tool" }),
    ];
    expect(extractProposedClientAction(parts, ALLOWED)).toBeUndefined();
  });

  it("ignores proposals the backend marked as failed", () => {
    expect(
      extractProposedClientAction([toolUsePart({ status: "error" })], ALLOWED),
    ).toBeUndefined();
    expect(
      extractProposedClientAction(
        [toolUsePart({ status: "in_progress" })],
        ALLOWED,
      ),
    ).toBeUndefined();
  });

  it("ignores malformed inputs", () => {
    expect(
      extractProposedClientAction([toolUsePart({ input: null })], ALLOWED),
    ).toBeUndefined();
    expect(
      extractProposedClientAction([toolUsePart({ input: "reply" })], ALLOWED),
    ).toBeUndefined();
    expect(
      extractProposedClientAction(
        [toolUsePart({ input: { action: 42 } })],
        ALLOWED,
      ),
    ).toBeUndefined();
    expect(
      extractProposedClientAction([toolUsePart({ input: {} })], ALLOWED),
    ).toBeUndefined();
  });

  it("rejects actions outside the facet's allowed list, even if implemented", () => {
    expect(
      extractProposedClientAction(
        [toolUsePart({ input: { action: "outlook.reply_all" } })],
        ["outlook.reply"],
      ),
    ).toBeUndefined();
  });

  it("rejects allowed-but-unimplemented actions", () => {
    expect(
      extractProposedClientAction(
        [toolUsePart({ input: { action: "teams.post" } })],
        ["teams.post"],
      ),
    ).toBeUndefined();
  });

  it("handles empty content", () => {
    expect(extractProposedClientAction(undefined, ALLOWED)).toBeUndefined();
    expect(extractProposedClientAction([], ALLOWED)).toBeUndefined();
  });

  it("accepts outlook.create_appointment only through BOTH gates", () => {
    const proposal = [
      toolUsePart({ input: { action: "outlook.create_appointment" } }),
    ];
    // In the registry AND in the facet's client_actions → accepted.
    expect(
      extractProposedClientAction(proposal, ["outlook.create_appointment"]),
    ).toBe("outlook.create_appointment");
    // Removed from the facet's client_actions → ignored despite the registry.
    expect(extractProposedClientAction(proposal, [])).toBeUndefined();
    expect(extractProposedClientAction(proposal, ALLOWED)).toBeUndefined();
    // Allowed by the facet but outside the registry → ignored (the second
    // gate; asserted with a look-alike id the add-in does not implement).
    expect(
      extractProposedClientAction(
        [toolUsePart({ input: { action: "outlook.create_meeting" } })],
        ["outlook.create_meeting"],
      ),
    ).toBeUndefined();
  });
});
