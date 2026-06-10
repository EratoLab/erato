import { describe, expect, it } from "vitest";

import {
  clientActionDecisionsPersistedOptions,
  decisionKey,
  effectiveDecision,
  isActionDenied,
  resolveAutoPromptBehavior,
  resolveClickBehavior,
  type ClientActionDecisionMap,
} from "../clientActionPolicy";

const FACET = "outlook_reply_from_read";
const REPLY = "outlook.reply" as const;
const REPLY_ALL = "outlook.reply_all" as const;

const base = {
  facetId: FACET,
  decisions: {} as ClientActionDecisionMap,
  enforcedAskActions: [] as string[],
};

describe("effectiveDecision", () => {
  it("defaults every action to ask — no pre-granted permissions", () => {
    expect(effectiveDecision({ ...base, action: REPLY })).toBe("ask");
    expect(effectiveDecision({ ...base, action: REPLY_ALL })).toBe("ask");
  });

  it("honors a stored user grant", () => {
    expect(
      effectiveDecision({
        ...base,
        action: REPLY,
        decisions: { [decisionKey(FACET, REPLY)]: "always" },
      }),
    ).toBe("always");
  });

  it("clamps a stored grant back to ask when the deployment enforces confirmation", () => {
    expect(
      effectiveDecision({
        ...base,
        action: REPLY_ALL,
        decisions: { [decisionKey(FACET, REPLY_ALL)]: "always" },
        enforcedAskActions: [REPLY_ALL],
      }),
    ).toBe("ask");
  });

  it("honors never regardless of enforcement (stricter than server is fine)", () => {
    expect(
      effectiveDecision({
        ...base,
        action: REPLY_ALL,
        decisions: { [decisionKey(FACET, REPLY_ALL)]: "never" },
        enforcedAskActions: [REPLY_ALL],
      }),
    ).toBe("never");
  });

  it("scopes decisions per facet — a grant for one facet never leaks to another", () => {
    const decisions = { [decisionKey(FACET, REPLY)]: "always" } as const;
    expect(
      effectiveDecision({
        facetId: "some_other_facet",
        action: REPLY,
        decisions,
        enforcedAskActions: [],
      }),
    ).toBe("ask");
  });
});

describe("resolveClickBehavior / isActionDenied", () => {
  it("ask confirms, always executes, never hides", () => {
    expect(resolveClickBehavior({ ...base, action: REPLY })).toBe("confirm");
    expect(
      resolveClickBehavior({
        ...base,
        action: REPLY,
        decisions: { [decisionKey(FACET, REPLY)]: "always" },
      }),
    ).toBe("execute");
    expect(
      isActionDenied({
        ...base,
        action: REPLY,
        decisions: { [decisionKey(FACET, REPLY)]: "never" },
      }),
    ).toBe(true);
  });
});

describe("resolveAutoPromptBehavior", () => {
  const auto = {
    presentation: "auto_prompt",
    facetId: FACET,
    proposedAction: REPLY,
    isFreshCompletion: true,
    decisions: {} as ClientActionDecisionMap,
    enforcedAskActions: [] as string[],
  };

  it("surfaces the card by default (ask)", () => {
    expect(resolveAutoPromptBehavior(auto)).toBe("confirm");
  });

  it("executes only after a user-granted always", () => {
    expect(
      resolveAutoPromptBehavior({
        ...auto,
        decisions: { [decisionKey(FACET, REPLY)]: "always" },
      }),
    ).toBe("execute");
  });

  it("never executes when the deployment enforces confirmation", () => {
    expect(
      resolveAutoPromptBehavior({
        ...auto,
        proposedAction: REPLY_ALL,
        decisions: { [decisionKey(FACET, REPLY_ALL)]: "always" },
        enforcedAskActions: [REPLY_ALL],
      }),
    ).toBe("confirm");
  });

  it("stays silent without auto_prompt, freshness, proposal, or when denied", () => {
    expect(
      resolveAutoPromptBehavior({ ...auto, presentation: "render_buttons" }),
    ).toBe("none");
    expect(
      resolveAutoPromptBehavior({ ...auto, isFreshCompletion: false }),
    ).toBe("none");
    expect(
      resolveAutoPromptBehavior({ ...auto, proposedAction: undefined }),
    ).toBe("none");
    expect(resolveAutoPromptBehavior({ ...auto, facetId: undefined })).toBe(
      "none",
    );
    expect(
      resolveAutoPromptBehavior({
        ...auto,
        decisions: { [decisionKey(FACET, REPLY)]: "never" },
      }),
    ).toBe("none");
  });
});

describe("clientActionDecisionsPersistedOptions.parse", () => {
  const parse = clientActionDecisionsPersistedOptions.parse;

  it("accepts a valid stored map", () => {
    expect(
      parse({
        [decisionKey(FACET, REPLY)]: "always",
        [decisionKey(FACET, REPLY_ALL)]: "never",
      }),
    ).toEqual({
      [decisionKey(FACET, REPLY)]: "always",
      [decisionKey(FACET, REPLY_ALL)]: "never",
    });
  });

  it("drops malformed or unimplemented entries instead of resetting everything", () => {
    expect(
      parse({
        [decisionKey(FACET, REPLY)]: "always",
        "no-separator": "always",
        [decisionKey(FACET, "outlook.unknown")]: "always",
        [decisionKey(FACET, REPLY_ALL)]: "yolo",
      }),
    ).toEqual({ [decisionKey(FACET, REPLY)]: "always" });
  });

  it("normalizes redundant ask entries away", () => {
    expect(parse({ [decisionKey(FACET, REPLY)]: "ask" })).toEqual({});
  });

  it("rejects non-object values", () => {
    expect(parse("always")).toBeNull();
    expect(parse(null)).toBeNull();
    expect(parse(["always"])).toBeNull();
  });
});
