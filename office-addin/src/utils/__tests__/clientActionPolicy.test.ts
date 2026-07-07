import { afterEach, describe, expect, it } from "vitest";

import {
  CLIENT_ACTION_DECISIONS_KEY,
  clientActionDecisionsPersistedOptions,
  decisionKey,
  effectiveDecision,
  isActionDenied,
  mergeIntoStoredDecisions,
  parseDecisionKey,
  resolveAutoPromptBehavior,
  resolveClickBehavior,
  type ClientActionDecisionMap,
} from "../clientActionPolicy";

const FACET = "outlook_reply_from_read";
const REPLY = "outlook.reply" as const;
const REPLY_ALL = "outlook.reply_all" as const;
const CREATE = "outlook.create_appointment" as const;

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

  it("click-is-consent actions execute on click regardless of decision or enforcement", () => {
    expect(resolveClickBehavior({ ...base, action: CREATE })).toBe("execute");
    // Enforcement gates assistant-initiated execution, not clicks.
    expect(
      resolveClickBehavior({
        ...base,
        action: CREATE,
        enforcedAskActions: [CREATE],
      }),
    ).toBe("execute");
    expect(
      resolveClickBehavior({
        ...base,
        action: CREATE,
        decisions: { [decisionKey(FACET, CREATE)]: "always" },
        enforcedAskActions: [CREATE],
      }),
    ).toBe("execute");
  });

  it("email actions keep confirming when enforcement clamps a stored grant", () => {
    expect(
      resolveClickBehavior({
        ...base,
        action: REPLY_ALL,
        decisions: { [decisionKey(FACET, REPLY_ALL)]: "always" },
        enforcedAskActions: [REPLY_ALL],
      }),
    ).toBe("confirm");
  });
});

describe("resolveAutoPromptBehavior", () => {
  const auto = {
    presentation: "auto_prompt",
    facetId: FACET,
    proposedAction: REPLY,
    isFreshCompletion: true,
    isLatestAssistantMessage: true,
    expectedItemIdentity: "item-1",
    currentItemIdentity: "item-1",
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

  it("click-is-consent never leaks into auto-prompt: enforced create_appointment still cards", () => {
    expect(
      resolveAutoPromptBehavior({
        ...auto,
        proposedAction: CREATE,
        decisions: { [decisionKey(FACET, CREATE)]: "always" },
        enforcedAskActions: [CREATE],
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

  it("fails closed when no send-time identity was recorded", () => {
    expect(
      resolveAutoPromptBehavior({ ...auto, expectedItemIdentity: undefined }),
    ).toBe("none");
    expect(
      resolveAutoPromptBehavior({ ...auto, expectedItemIdentity: null }),
    ).toBe("none");
  });

  it("stays silent for an identity-unknown completion degraded to history-like (not fresh, no identity)", () => {
    // The shape AddinChat emits when a regenerate/edit completes but the
    // original exchange's send-time identity is no longer known (e.g. after
    // a reload): not stamped fresh, no identity. Even a stored grant must
    // not let it auto-open — only the user's explicit click may act on it.
    expect(
      resolveAutoPromptBehavior({
        ...auto,
        isFreshCompletion: false,
        expectedItemIdentity: undefined,
        decisions: { [decisionKey(FACET, REPLY)]: "always" },
      }),
    ).toBe("none");
  });

  it("stays silent when the open item differs from the send-time item", () => {
    expect(
      resolveAutoPromptBehavior({ ...auto, currentItemIdentity: "item-2" }),
    ).toBe("none");
    expect(
      resolveAutoPromptBehavior({ ...auto, currentItemIdentity: null }),
    ).toBe("none");
  });

  it("keeps the decision-driven behavior when the identities match", () => {
    expect(resolveAutoPromptBehavior(auto)).toBe("confirm");
    expect(
      resolveAutoPromptBehavior({
        ...auto,
        decisions: { [decisionKey(FACET, REPLY)]: "always" },
      }),
    ).toBe("execute");
  });

  it("stays silent for a message that is no longer the latest assistant message", () => {
    expect(
      resolveAutoPromptBehavior({ ...auto, isLatestAssistantMessage: false }),
    ).toBe("none");
  });
});

describe("parseDecisionKey", () => {
  it("splits at the LAST separator — facet ids may themselves contain one", () => {
    expect(parseDecisionKey(decisionKey("team/eu/replies", REPLY))).toEqual({
      facetId: "team/eu/replies",
      action: REPLY,
    });
  });

  it("rejects keys without a facet or action side", () => {
    expect(parseDecisionKey("no-separator")).toBeNull();
    expect(parseDecisionKey("/outlook.reply")).toBeNull();
    expect(parseDecisionKey("facet/")).toBeNull();
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

  it("keeps a persistent deny for a facet id containing a separator", () => {
    const facetWithSlash = "team/eu/replies";
    const stored = parse({ [decisionKey(facetWithSlash, REPLY)]: "never" });
    expect(stored).toEqual({ [decisionKey(facetWithSlash, REPLY)]: "never" });
    expect(
      effectiveDecision({
        facetId: facetWithSlash,
        action: REPLY,
        decisions: stored ?? {},
        enforcedAskActions: [],
      }),
    ).toBe("never");
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

describe("mergeIntoStoredDecisions / serialize round-trip", () => {
  afterEach(() => {
    localStorage.removeItem(CLIENT_ACTION_DECISIONS_KEY);
  });

  it("preserves entries this build cannot parse while replacing its own", () => {
    expect(
      mergeIntoStoredDecisions(
        {
          [decisionKey(FACET, "outlook.future_action")]: "always",
          [decisionKey(FACET, REPLY_ALL)]: "always_for_session",
          [decisionKey(FACET, REPLY)]: "never",
          "no-separator": "always",
        },
        {
          [decisionKey(FACET, REPLY)]: "always",
          // Same key as the preserved unknown-decision entry: the new value
          // wins — keyed collisions never duplicate.
          [decisionKey(FACET, REPLY_ALL)]: "never",
        },
      ),
    ).toEqual({
      [decisionKey(FACET, "outlook.future_action")]: "always",
      "no-separator": "always",
      [decisionKey(FACET, REPLY)]: "always",
      [decisionKey(FACET, REPLY_ALL)]: "never",
    });
  });

  it("lets owned removals stick — an entry absent from the new map is dropped", () => {
    expect(
      mergeIntoStoredDecisions({ [decisionKey(FACET, REPLY)]: "always" }, {}),
    ).toEqual({});
  });

  it("starts from the new map alone when the stored value is not an object", () => {
    expect(
      mergeIntoStoredDecisions("corrupt", {
        [decisionKey(FACET, REPLY)]: "never",
      }),
    ).toEqual({ [decisionKey(FACET, REPLY)]: "never" });
  });

  it("serialize keeps an unknown-action entry across a write", () => {
    const futureKey = decisionKey(FACET, "outlook.future_action");
    localStorage.setItem(
      CLIENT_ACTION_DECISIONS_KEY,
      JSON.stringify({ [futureKey]: "never" }),
    );
    const written = clientActionDecisionsPersistedOptions.serialize?.({
      [decisionKey(FACET, REPLY)]: "always",
    });
    expect(JSON.parse(written ?? "")).toEqual({
      [futureKey]: "never",
      [decisionKey(FACET, REPLY)]: "always",
    });
  });
});
