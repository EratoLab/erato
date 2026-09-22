import { describe, expect, it } from "vitest";

import { wordClientActionDecisionStore } from "../clientActionPolicy";

describe("the Word decision store", () => {
  it("uses the Word storage key, never Outlook's", () => {
    expect(wordClientActionDecisionStore.storageKey).toBe(
      "erato.addin.word.clientActionDecisions",
    );
    expect(wordClientActionDecisionStore.storageKey).not.toBe(
      "erato.outlookAddin.clientActionDecisions",
    );
  });

  it("keeps Word decisions keyed per facet AND action", () => {
    expect(
      wordClientActionDecisionStore.persistedOptions.parse?.({
        "word_document_review/word.apply_edits": "always",
        "word_compose/word.insert_at_cursor": "never",
      }),
    ).toEqual({
      "word_document_review/word.apply_edits": "always",
      "word_compose/word.insert_at_cursor": "never",
    });
  });

  it("drops another host's entries on read", () => {
    // Two hosts must never share a key: each store's parse drops what it does
    // not implement, so a shared key would have each pane deleting the other's
    // decisions on the next write.
    expect(
      wordClientActionDecisionStore.persistedOptions.parse?.({
        "outlook_reply_from_read/outlook.reply": "always",
        "word_document_review/word.apply_edits": "always",
      }),
    ).toEqual({ "word_document_review/word.apply_edits": "always" });
  });

  it("drops an unimplemented Word action and an unknown decision value", () => {
    expect(
      wordClientActionDecisionStore.persistedOptions.parse?.({
        // v2, not in this build's registry.
        "word_selection/word.replace_selection": "always",
        "word_document_review/word.apply_edits": "sometimes",
      }),
    ).toEqual({});
  });

  it("writes the map under the Word key", () => {
    const serialized =
      wordClientActionDecisionStore.persistedOptions.serialize?.({
        "word_document_review/word.apply_edits": "always",
      });

    // Nothing stored under the Word key yet, so the write is just the map —
    // the forward-compatibility merge is covered by the core suite.
    expect(JSON.parse(serialized!)).toEqual({
      "word_document_review/word.apply_edits": "always",
    });
  });
});
