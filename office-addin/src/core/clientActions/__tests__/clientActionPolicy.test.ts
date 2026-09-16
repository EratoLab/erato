import { afterEach, describe, expect, it } from "vitest";

import {
  createClientActionDecisionStore,
  decisionKey,
  effectiveDecision,
  mergeIntoStoredDecisions,
  resolveAutoPromptBehavior,
} from "../clientActionPolicy";

// A synthetic non-Outlook host: proves the engine is bound to a registry
// only through the injected predicate, never to a concrete action union.
const WORD_KEY = "erato.addin.word.clientActionDecisions";
const OUTLOOK_KEY = "erato.outlookAddin.clientActionDecisions";
const WORD_ACTIONS = ["word.apply_edits"] as const;
type WordClientAction = (typeof WORD_ACTIONS)[number];
const isWordAction = (action: string): action is WordClientAction =>
  (WORD_ACTIONS as readonly string[]).includes(action);
const FACET = "word_edit_selection";
const APPLY: WordClientAction = "word.apply_edits";

const wordStore = createClientActionDecisionStore({
  storageKey: WORD_KEY,
  isImplementedAction: isWordAction,
});
const outlookStore = createClientActionDecisionStore({
  storageKey: OUTLOOK_KEY,
  isImplementedAction: (action) => action === "outlook.reply",
});

afterEach(() => {
  localStorage.removeItem(WORD_KEY);
  localStorage.removeItem(OUTLOOK_KEY);
});

describe("createClientActionDecisionStore", () => {
  it("exposes the injected key and an empty default map", () => {
    expect(wordStore.storageKey).toBe(WORD_KEY);
    expect(wordStore.defaultDecisions).toEqual({});
    expect(wordStore.isImplementedAction("word.apply_edits")).toBe(true);
    expect(wordStore.isImplementedAction("outlook.reply")).toBe(false);
  });

  it("parse keeps only entries the host implements", () => {
    expect(
      wordStore.persistedOptions.parse({
        [decisionKey(FACET, APPLY)]: "always",
        [decisionKey(FACET, "outlook.reply")]: "never",
        [decisionKey(FACET, "word.future_action")]: "never",
        [decisionKey(FACET, APPLY.toUpperCase())]: "always",
      }),
    ).toEqual({ [decisionKey(FACET, APPLY)]: "always" });
  });

  it("parse isolates hosts: the same raw map reads differently per registry", () => {
    const raw = {
      [decisionKey(FACET, APPLY)]: "always",
      [decisionKey("outlook_reply_from_read", "outlook.reply")]: "never",
    };
    expect(wordStore.persistedOptions.parse(raw)).toEqual({
      [decisionKey(FACET, APPLY)]: "always",
    });
    expect(outlookStore.persistedOptions.parse(raw)).toEqual({
      [decisionKey("outlook_reply_from_read", "outlook.reply")]: "never",
    });
  });

  it("serialize merges against the raw value under ITS OWN key only", () => {
    localStorage.setItem(
      WORD_KEY,
      JSON.stringify({
        [decisionKey(FACET, "word.future_action")]: "never",
        [decisionKey(FACET, APPLY)]: "always",
      }),
    );
    localStorage.setItem(
      OUTLOOK_KEY,
      JSON.stringify({
        [decisionKey("outlook_reply_from_read", "outlook.reply")]: "always",
      }),
    );

    const written = JSON.parse(
      wordStore.persistedOptions.serialize!({}),
    ) as Record<string, unknown>;

    // The foreign (unimplemented-here) entry survives, the owned removal
    // sticks, and nothing from the other host's key leaks in.
    expect(written).toEqual({
      [decisionKey(FACET, "word.future_action")]: "never",
    });
    expect(localStorage.getItem(OUTLOOK_KEY)).toBe(
      JSON.stringify({
        [decisionKey("outlook_reply_from_read", "outlook.reply")]: "always",
      }),
    );
  });

  it("serialize starts from the new map alone when nothing is stored", () => {
    expect(
      JSON.parse(
        wordStore.persistedOptions.serialize!({
          [decisionKey(FACET, APPLY)]: "never",
        }),
      ),
    ).toEqual({ [decisionKey(FACET, APPLY)]: "never" });
  });

  it("keeps a stable options identity so setters do not churn", () => {
    expect(wordStore.persistedOptions).toBe(wordStore.persistedOptions);
    expect(wordStore.persistedOptions).not.toBe(outlookStore.persistedOptions);
  });
});

describe("mergeIntoStoredDecisions with an injected registry", () => {
  it("replaces owned entries and preserves the rest", () => {
    expect(
      mergeIntoStoredDecisions(
        {
          [decisionKey(FACET, APPLY)]: "always",
          [decisionKey(FACET, "outlook.reply")]: "never",
          "not-a-key": "always",
        },
        { [decisionKey(FACET, APPLY)]: "never" },
        isWordAction,
      ),
    ).toEqual({
      [decisionKey(FACET, APPLY)]: "never",
      [decisionKey(FACET, "outlook.reply")]: "never",
      "not-a-key": "always",
    });
  });
});

describe("decision functions accept any host action id", () => {
  it("resolves a word action through the same ask/always/never model", () => {
    const decisions = { [decisionKey(FACET, APPLY)]: "always" as const };
    expect(
      effectiveDecision({
        facetId: FACET,
        action: APPLY,
        decisions,
        enforcedAskActions: [],
      }),
    ).toBe("always");
    expect(
      effectiveDecision({
        facetId: FACET,
        action: APPLY,
        decisions,
        enforcedAskActions: [APPLY],
      }),
    ).toBe("ask");
    expect(
      resolveAutoPromptBehavior({
        presentation: "auto_prompt",
        facetId: FACET,
        proposedAction: APPLY,
        isFreshCompletion: true,
        isLatestAssistantMessage: true,
        expectedItemIdentity: "doc-1",
        currentItemIdentity: "doc-1",
        decisions,
        enforcedAskActions: [],
      }),
    ).toBe("execute");
  });
});
