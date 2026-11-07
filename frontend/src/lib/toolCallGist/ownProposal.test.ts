import { i18n } from "@lingui/core";
import { afterEach, describe, expect, it } from "vitest";

import { WORD_COMMENT_OPS } from "@/lib/wordReview/wordCommentChanges";
import { messages as deMessages } from "@/locales/de/messages.json";
import { messages as enMessages } from "@/locales/en/messages.json";
import { messages as plMessages } from "@/locales/pl/messages.json";

import { GIST_PHASES } from "./gist";
import { OWN_PROPOSAL_KINDS, ownProposalOf } from "./ownProposal";
import {
  commentChangeRow,
  commentOpCount,
  isMixedCommentProposal,
  ownProposalLine,
  ownProposalObject,
} from "./ownProposalLabels";

import type { OwnProposal } from "./ownProposal";
import type {
  ToolCallAction,
  ToolCallLabel,
  ToolCallObjectKind,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

const activate = (locale: "de" | "en" | "pl") => {
  const catalogs = { de: deMessages, en: enMessages, pl: plMessages };
  i18n.load(locale, catalogs[locale] as unknown as Messages);
  i18n.activate(locale);
};

const own = (
  action: ToolCallAction,
  object_kind: ToolCallObjectKind,
  extra: Partial<ToolCallLabel> = {},
): ToolCallLabel => ({ action, object_kind, source: "own_mapping", ...extra });

/** The label `word_submit_comment_changes` gets from its hand-written table. */
const commentLabel = (ops: string[]): ToolCallLabel =>
  own("comment", "comment", {
    items: [
      {
        fields: [
          {
            pointer: "/changes/*/op",
            name: "op",
            values: ops
              .slice(0, 10)
              .map((op, index) => ({ path: `/changes/${index}/op`, text: op })),
            omitted: Math.max(ops.length - 10, 0),
          },
        ],
      },
    ],
  });

const changes = (ops: string[]) => ({
  changes: ops.map((op, index) => ({
    op,
    anchor: null,
    thread: `t_${index}`,
    target: null,
    text: op === "reply" ? "Reply text A" : null,
  })),
});

const proposalOf = (ops: string[]) =>
  ownProposalOf(commentLabel(ops), changes(ops))!;

describe("Erato's own proposals", () => {
  afterEach(() => activate("en"));

  it("names what each of Erato's own labels proposes, and nothing else", () => {
    expect(ownProposalOf(own("update", "document"), {})).toEqual({
      kind: "document",
    });
    expect(ownProposalOf(own("send", "email"), {})).toEqual({ kind: "email" });
    expect(ownProposalOf(own("create", "event"), {})).toEqual({
      kind: "event",
    });
    expect(ownProposalOf(own("other", "other"), {})).toEqual({
      kind: "action",
    });
    expect(ownProposalOf(own("move", "row"), {})).toEqual({ kind: "action" });
    expect(ownProposalOf(own("update", "comment"), {})).toEqual({
      kind: "comments",
      changes: [],
    });
    for (const source of ["rules", "model", "generic"] as const) {
      expect(
        ownProposalOf({ ...own("update", "document"), source }, {}),
      ).toBeUndefined();
    }
    expect(ownProposalOf(undefined, {})).toBeUndefined();
    expect(ownProposalOf(null, {})).toBeUndefined();
  });

  it("counts every change from the input, past the values the label keeps", () => {
    const ops = Array.from({ length: 14 }, () => "resolve");
    expect(proposalOf(ops)).toEqual({ kind: "comments", changes: ops });
    expect(ownProposalLine(proposalOf(ops), "done")).toBe(
      "Proposed to resolve 14 comments",
    );
    expect(proposalOf(["reply", "archive"])).toEqual({
      kind: "comments",
      changes: ["reply", "other"],
    });
  });

  it("names a batch of one operation by it, in every phase", () => {
    expect(ownProposalLine(proposalOf(["reply"]), "done")).toBe(
      "Proposed a reply to a comment",
    );
    expect(
      ownProposalLine(proposalOf(["reply", "reply", "reply"]), "done"),
    ).toBe("Proposed replies to 3 comments");
    expect(ownProposalLine(proposalOf(["add", "add"]), "ask")).toBe(
      "Propose 2 new comments",
    );
    expect(ownProposalLine(proposalOf(["delete"]), "failed")).toBe(
      "Could not propose to delete a comment",
    );
    expect(ownProposalLine({ kind: "document" }, "done")).toBe(
      "Proposed changes to the document",
    );
  });

  it("counts a mixed batch per operation, and lists one row per change", () => {
    const mixed = proposalOf(["reply", "resolve", "resolve", "reopen"]);
    expect(isMixedCommentProposal(mixed)).toBe(true);
    expect(ownProposalLine(mixed, "done")).toBe(
      "Proposed 4 comment changes · 1 reply · 2 resolved · 1 reopened",
    );
    const unknown = proposalOf(["edit", "archive"]);
    expect(ownProposalLine(unknown, "done")).toBe(
      "Proposed 2 comment changes · 1 edited",
    );
    expect(isMixedCommentProposal(proposalOf(["edit", "edit"]))).toBe(false);
    expect(isMixedCommentProposal({ kind: "document" })).toBe(false);
  });

  it("has words for every proposal, operation and phase, and never the call's text", () => {
    const proposals: Record<(typeof OWN_PROPOSAL_KINDS)[number], OwnProposal> =
      {
        document: { kind: "document" },
        comments: { kind: "comments", changes: [] },
        email: { kind: "email" },
        event: { kind: "event" },
        action: { kind: "action" },
      };
    for (const locale of ["en", "de", "pl"] as const) {
      activate(locale);
      const lines = OWN_PROPOSAL_KINDS.flatMap((kind) =>
        GIST_PHASES.map((phase) => ownProposalLine(proposals[kind], phase)),
      );
      expect(new Set(lines).size).toBe(lines.length);
      for (const op of WORD_COMMENT_OPS) {
        const one = ownProposalObject({ kind: "comments", changes: [op] });
        const many = ownProposalObject({ kind: "comments", changes: [op, op] });
        expect(one).not.toMatch(/\d|toolGist/);
        expect(many).toMatch(/2/);
        expect(commentOpCount(op, 3)).toMatch(/3/);
        expect(commentChangeRow(op)).not.toMatch(/toolGist/);
      }
      expect(commentChangeRow("other")).not.toMatch(/toolGist/);
      const withText = ownProposalLine(
        proposalOf(["reply", "resolve"]),
        "done",
      );
      expect(withText).not.toContain("Reply text");
    }
  });

  it("reads a stored label of any shape without failing the row", () => {
    const odd = (extra: Record<string, unknown>): ToolCallLabel => ({
      ...own("comment", "comment"),
      ...extra,
    });
    const input = changes(["reply", "resolve"]);
    for (const items of [
      "items",
      42,
      { fields: [] },
      [null],
      [1, "op", []],
      [{ fields: "op" }],
      [{ fields: { name: "op" } }],
      [{ fields: [null, 7, { name: "op" }] }],
      [{ fields: [{ name: "op", pointer: 42 }] }],
      [{ fields: [{ name: "op", pointer: { "/changes": 1 } }] }],
      [{ fields: [{ name: "op", pointer: "changes/*/op" }] }],
    ]) {
      expect(ownProposalOf(odd({ items }), input)).toEqual({
        kind: "comments",
        changes: [],
      });
    }
    for (const stored of ["own_mapping", 42, [own("update", "document")]]) {
      expect(
        ownProposalOf(stored as unknown as ToolCallLabel, input),
      ).toBeUndefined();
    }
    for (const [action, kind] of [
      [42, "comment"],
      ["update", null],
      ["share", "spreadsheet"],
      [["update"], "document"],
    ]) {
      expect(
        ownProposalOf(odd({ action, object_kind: kind, items: [] }), input),
      ).toEqual({ kind: "action" });
    }
  });

  it("counts operations of any shape and input of any shape", () => {
    const label = commentLabel([]);
    const oddOps = {
      changes: [
        { op: { op: "reply" } },
        { op: ["resolve"] },
        { op: 7 },
        { op: "RESOLVE" },
        { op: "reply\u202E" },
        { op: "x".repeat(1_000_000) },
        null,
        "reply",
      ],
    };
    expect(ownProposalOf(label, oddOps)).toEqual({
      kind: "comments",
      changes: ["other", "other", "other", "other", "other", "other"],
    });
    let deep: unknown = { changes: [{ op: "reply" }] };
    for (let depth = 0; depth < 10_000; depth++) deep = { next: deep };
    for (const input of [
      undefined,
      null,
      "not json {",
      42,
      [],
      { changes: "reply" },
      { changes: { a: { op: "reply" } } },
      deep,
    ]) {
      const proposal = ownProposalOf(label, input);
      expect(proposal?.kind).toBe("comments");
      expect(() => ownProposalLine(proposal!, "done")).not.toThrow();
    }
  });

  it("names a batch too large to count without a number", () => {
    const ops = Array.from({ length: 10_001 }, () => "resolve");
    const proposal = proposalOf(ops);
    expect(proposal).toEqual({ kind: "comments", changes: [] });
    expect(ownProposalLine(proposal, "done")).toBe("Proposed comment changes");
    expect(proposalOf(ops.slice(1))).toMatchObject({
      changes: { length: 10_000 },
    });
  });

  it("lets a language word the proposal its own way", () => {
    activate("de");
    expect(ownProposalLine({ kind: "document" }, "done")).toBe(
      "Vorgeschlagen: Änderungen am Dokument",
    );
    activate("pl");
    expect(
      ownProposalLine(
        proposalOf(["resolve", "resolve", "resolve", "resolve", "resolve"]),
        "done",
      ),
    ).toBe("Zaproponowano: rozwiązanie 5 komentarzy");
  });
});
