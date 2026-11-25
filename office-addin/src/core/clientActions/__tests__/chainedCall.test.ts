import { describe, expect, it } from "vitest";

import { chainedProposalState } from "../chainedCall";

import type { ContentPart } from "@erato/frontend/library";

const proposal = (
  id: string,
  action: string,
  output: Record<string, unknown>,
  status = "success",
) => ({
  content_type: "tool_use",
  tool_call_id: id,
  tool_name: "propose_client_action",
  status,
  input: { action },
  output,
});

const call = (id: string, status: string, output: Record<string, unknown>) => ({
  content_type: "tool_use",
  tool_call_id: id,
  tool_name: "open_reply",
  status,
  input: {},
  output,
});

const stateOf = (content: unknown[]) =>
  chainedProposalState(
    content as ContentPart[],
    ["outlook.reply", "outlook.reply_all"],
    () => false,
  );

describe("chainedProposalState", () => {
  it("keeps to the chained proposal when the server refused a second one", () => {
    expect(
      stateOf([
        proposal("A", "outlook.reply", { apply: { call_id: "A.apply" } }),
        proposal(
          "B",
          "outlook.reply_all",
          { status: "rejected", error: "already proposed" },
          "error",
        ),
        call("A.apply", "error", { status: "rejected" }),
      ]),
    ).toEqual({ kind: "cancelled" });
  });

  it("follows the newest chained proposal after a change was asked for", () => {
    expect(
      stateOf([
        proposal("A", "outlook.reply", { apply: { call_id: "A.apply" } }),
        call("A.apply", "error", { status: "change_requested" }),
        proposal("C", "outlook.reply", { apply: { call_id: "C.apply" } }),
      ]),
    ).toEqual({ kind: "waiting" });
  });

  it("leaves the card's own buttons to act when the card says so", () => {
    expect(
      chainedProposalState(
        [
          proposal("A", "outlook.reply", { apply: { call_id: "A.apply" } }),
        ] as unknown as ContentPart[],
        ["outlook.reply"],
        () => true,
      ),
    ).toBeUndefined();
  });
});
