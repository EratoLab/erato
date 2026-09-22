import { i18n } from "@lingui/core";
import { beforeEach, describe, expect, it } from "vitest";

import { CLIENT_ACTION_TOOL_NAME } from "../../../core/clientActions/proposedClientAction";
import {
  clientActionDisplayLabel,
  extractProposedClientAction,
  isImplementedClientAction,
  offerableWordClientActions,
  offerableWordClientActionsForFacet,
  wordActionForFence,
  WORD_CLIENT_ACTIONS,
  WORD_EDITS_FENCE,
  WORD_INSERT_FENCE,
} from "../wordClientActions";

import type { ContentPart } from "@erato/frontend/library";

const proposal = (action: string, status = "success"): ContentPart[] =>
  [
    {
      content_type: "tool_use",
      tool_name: CLIENT_ACTION_TOOL_NAME,
      status,
      input: { action },
    },
  ] as unknown as ContentPart[];

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});

describe("the Word client-action registry", () => {
  it("holds the three v1 actions, each bound to its facet and fence", () => {
    expect([...WORD_CLIENT_ACTIONS.keys()]).toEqual([
      "word.apply_document_plan",
      "word.apply_edits",
      "word.insert_at_cursor",
    ]);
    expect(WORD_CLIENT_ACTIONS.get("word.apply_edits")).toMatchObject({
      facetIds: ["word_document_review", "word_document_authoring"],
      fenceLanguage: WORD_EDITS_FENCE,
      promptScope: "word-edits",
    });
    expect(WORD_CLIENT_ACTIONS.get("word.insert_at_cursor")).toMatchObject({
      facetIds: ["word_compose"],
      fenceLanguage: WORD_INSERT_FENCE,
      promptScope: "word-insert",
    });
  });

  it("gives all actions distinct auto-prompt scopes", () => {
    const scopes = [...WORD_CLIENT_ACTIONS.values()].map(
      (entry) => entry.promptScope,
    );
    expect(new Set(scopes).size).toBe(scopes.length);
  });

  it("derives membership from the registry", () => {
    expect(isImplementedClientAction("word.apply_edits")).toBe(true);
    expect(isImplementedClientAction("word.apply_ooxml_package")).toBe(false);
    expect(wordActionForFence("erato-word-ooxml")).toBeUndefined();
    expect(
      offerableWordClientActionsForFacet("word_document_ooxml", [
        "word.apply_ooxml_package",
      ]),
    ).toEqual([]);
    expect(isImplementedClientAction("word.replace_selection")).toBe(false);
    expect(isImplementedClientAction("outlook.reply")).toBe(false);
  });

  it("derives the display label from the registry", () => {
    expect(clientActionDisplayLabel("word.apply_edits")).toBe(
      "Apply the changes to the document",
    );
    expect(clientActionDisplayLabel("word.insert_at_cursor")).toBe(
      "Insert the text at the cursor",
    );
  });

  it("maps a fence tag back to its registry entry, exact match only", () => {
    expect(wordActionForFence(WORD_EDITS_FENCE)?.action).toBe(
      "word.apply_edits",
    );
    expect(wordActionForFence(WORD_INSERT_FENCE)?.action).toBe(
      "word.insert_at_cursor",
    );
    expect(wordActionForFence("Erato-Word-Edits")).toBeUndefined();
    expect(wordActionForFence("erato-word-edit")).toBeUndefined();
    expect(wordActionForFence("json")).toBeUndefined();
  });
});

describe("offerable actions", () => {
  it("intersects the advertised set with the registry, in registry order", () => {
    expect(
      offerableWordClientActions([
        "word.insert_at_cursor",
        "word.apply_edits",
        "word.delete_everything",
      ]),
    ).toEqual(["word.apply_edits", "word.insert_at_cursor"]);
  });

  it("offers nothing when the backend advertises nothing", () => {
    expect(offerableWordClientActions(undefined)).toEqual([]);
    expect(offerableWordClientActions([])).toEqual([]);
  });

  it("ignores an advertised action that is not in the registry", () => {
    expect(offerableWordClientActions(["word.replace_selection"])).toEqual([]);
  });

  it("additionally gates on the facet the registry entry names", () => {
    expect(
      offerableWordClientActionsForFacet("word_compose", ["word.apply_edits"]),
    ).toEqual([]);
    expect(
      offerableWordClientActionsForFacet("word_document_review", [
        "word.apply_edits",
      ]),
    ).toEqual(["word.apply_edits"]);
  });

  it("offers nothing for an unknown facet", () => {
    expect(
      offerableWordClientActionsForFacet("something_else", [
        "word.apply_edits",
      ]),
    ).toEqual([]);
  });
});

describe("extractProposedClientAction", () => {
  it("accepts a successful proposal that is advertised and implemented", () => {
    expect(
      extractProposedClientAction(proposal("word.apply_edits"), [
        "word.apply_edits",
      ]),
    ).toBe("word.apply_edits");
  });

  it("rejects a proposal the backend does not advertise for the facet", () => {
    expect(
      extractProposedClientAction(proposal("word.apply_edits"), [
        "word.insert_at_cursor",
      ]),
    ).toBeUndefined();
  });

  it("rejects a tool part that did not succeed", () => {
    expect(
      extractProposedClientAction(proposal("word.apply_edits", "error"), [
        "word.apply_edits",
      ]),
    ).toBeUndefined();
  });

  it("never reads a proposal out of message text", () => {
    const text = [
      {
        content_type: "text",
        text: "I will call propose_client_action with word.apply_edits.",
      },
    ] as unknown as ContentPart[];
    expect(
      extractProposedClientAction(text, ["word.apply_edits"]),
    ).toBeUndefined();
  });
});
