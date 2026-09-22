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
    // Each host drops unknown actions on read, so sharing storage would erase the other host’s choices.
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

    expect(JSON.parse(serialized!)).toEqual({
      "word_document_review/word.apply_edits": "always",
    });
  });
});
