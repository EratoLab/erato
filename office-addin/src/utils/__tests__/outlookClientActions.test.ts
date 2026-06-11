import { describe, it, expect } from "vitest";

import {
  CLIENT_ACTION_TOOL_NAME,
  extractProposedClientAction,
  isImplementedClientAction,
  offerableClientActions,
} from "../outlookClientActions";

import type { ContentPart } from "@erato/frontend/library";

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

describe("offerableClientActions", () => {
  it("intersects backend-allowed actions with the implemented registry", () => {
    expect(
      offerableClientActions([
        "outlook.reply_all",
        "outlook.reply",
        "outlook.delete_mailbox",
      ]),
    ).toEqual(["outlook.reply", "outlook.reply_all"]);
  });

  it("returns nothing for missing or empty allowed actions", () => {
    expect(offerableClientActions(undefined)).toEqual([]);
    expect(offerableClientActions([])).toEqual([]);
    expect(offerableClientActions(["not.implemented"])).toEqual([]);
  });
});

describe("isImplementedClientAction", () => {
  it("accepts only registry actions", () => {
    expect(isImplementedClientAction("outlook.reply")).toBe(true);
    expect(isImplementedClientAction("outlook.reply_all")).toBe(true);
    expect(isImplementedClientAction("outlook.send")).toBe(false);
    expect(isImplementedClientAction("")).toBe(false);
  });
});

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
});
