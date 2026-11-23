import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  carriedOverDecisions,
  carryOverClientDecisions,
  CLIENT_DECISIONS_CARRIED_OVER_KEY,
  WORD_CARRY_OVER,
} from "../carryOverDecisions";

const STORE = "erato.addin.word.clientActionDecisions";
const PLAN = "word/apply_document_plan";
const COMMENTS = "word/apply_comment_changes";
const deviceWide = () => false;

describe("carrying the pane's choices over to the server", () => {
  it("keeps Always and Never for a change of the document", () => {
    expect(
      carriedOverDecisions({
        stored: {
          "word_document_authoring/word.apply_document_plan": "always",
        },
        mappings: WORD_CARRY_OVER,
        sessionOnly: deviceWide,
      }),
    ).toEqual({ [PLAN]: "always_allow" });
    expect(
      carriedOverDecisions({
        stored: { "word_document_authoring/word.apply_document_plan": "never" },
        mappings: WORD_CARRY_OVER,
        sessionOnly: deviceWide,
      }),
    ).toEqual({ [PLAN]: "never_allow" });
  });

  it("turns comment changes off only when every comment action was off", () => {
    const facet = "word_document_review";
    expect(
      carriedOverDecisions({
        stored: { [`${facet}/word.modify_comments`]: "never" },
        mappings: WORD_CARRY_OVER,
        sessionOnly: deviceWide,
      }),
    ).toEqual({});
    expect(
      carriedOverDecisions({
        stored: {
          [`${facet}/word.add_comments`]: "never",
          [`${facet}/word.respond_to_comments`]: "never",
          [`${facet}/word.modify_comments`]: "never",
        },
        mappings: WORD_CARRY_OVER,
        sessionOnly: deviceWide,
      }),
    ).toEqual({ [COMMENTS]: "never_allow" });
  });

  it("lets no facet's Never win over another facet's Always, nor the reverse", () => {
    expect(
      carriedOverDecisions({
        stored: {
          "word_document_authoring/word.apply_document_plan": "always",
          "word_other/word.apply_document_plan": "never",
        },
        mappings: WORD_CARRY_OVER,
        sessionOnly: deviceWide,
      }),
    ).toEqual({});
  });

  it("does not carry an Always the pane kept for one session and document", () => {
    expect(
      carriedOverDecisions({
        stored: { "word_document_review/word.add_comments": "always" },
        mappings: WORD_CARRY_OVER,
        sessionOnly: (_facet, action) => action === "word.add_comments",
      }),
    ).toEqual({});
    expect(
      carriedOverDecisions({
        stored: { "word_document_review/word.respond_to_comments": "always" },
        mappings: WORD_CARRY_OVER,
        sessionOnly: (_facet, action) => action === "word.add_comments",
      }),
    ).toEqual({ [COMMENTS]: "always_allow" });
  });

  it("leaves Ask unset, so the server asks", () => {
    expect(
      carriedOverDecisions({
        stored: { "word_document_authoring/word.apply_document_plan": "ask" },
        mappings: WORD_CARRY_OVER,
        sessionOnly: deviceWide,
      }),
    ).toEqual({});
  });
});

describe("the one-time carry-over", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  const run = (save = vi.fn(async () => [])) => ({
    save,
    done: carryOverClientDecisions({
      host: "word",
      storageKey: STORE,
      mappings: WORD_CARRY_OVER,
      offered: new Set([PLAN, COMMENTS]),
      sessionOnly: deviceWide,
      save,
    }),
  });

  it("saves once, sets the marker and keeps the old store", async () => {
    localStorage.setItem(
      STORE,
      JSON.stringify({
        "word_document_authoring/word.apply_document_plan": "always",
      }),
    );
    const first = run();
    expect(await first.done).toBe(true);
    expect(first.save).toHaveBeenCalledWith({ [PLAN]: "always_allow" });
    expect(
      JSON.parse(localStorage.getItem(CLIENT_DECISIONS_CARRIED_OVER_KEY)!),
    ).toEqual({ word: true });
    expect(localStorage.getItem(STORE)).not.toBeNull();
    const again = run();
    expect(await again.done).toBe(false);
    expect(again.save).not.toHaveBeenCalled();
  });

  it("tries again on the next load when saving fails", async () => {
    localStorage.setItem(
      STORE,
      JSON.stringify({
        "word_document_authoring/word.apply_document_plan": "never",
      }),
    );
    const failed = run(vi.fn(() => Promise.reject(new Error("offline"))));
    expect(await failed.done).toBe(false);
    expect(localStorage.getItem(CLIENT_DECISIONS_CARRIED_OVER_KEY)).toBeNull();
  });

  it("waits while storage cannot be read", async () => {
    vi.spyOn(globalThis.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const blocked = run();
    expect(await blocked.done).toBe(false);
    expect(blocked.save).not.toHaveBeenCalled();
  });
});
