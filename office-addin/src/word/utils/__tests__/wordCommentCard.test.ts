import { afterEach, describe, expect, it } from "vitest";

import {
  validationContext,
  storyFacts,
  threadMap,
} from "../../../test/mocks/word/commentDrafts";
import {
  wordCommentAlwaysBlock,
  wordCommentAuthorPlan,
  wordCommentOutcomeRecord,
} from "../wordCommentCard";
import {
  parseWordCommentChanges,
  validateWordCommentChanges,
} from "../wordCommentChanges";
import {
  noteWordCommentAssistantAuthorOff,
  resetWordCommentSession,
} from "../wordCommentPolicy";

import type { WordCommentValidationContext } from "../wordCommentChanges";

const STORY = storyFacts(["One alpha.", "Two beta.", "Three gamma."]);

function draftOf(
  changes: unknown[],
  overrides: Partial<WordCommentValidationContext> = {},
) {
  const ctx = validationContext({
    story: STORY,
    captured: new Map(
      STORY.entries.map((e, i) => [
        i + 1,
        { uniqueLocalId: e.id, text: e.text },
      ]),
    ),
    threads: threadMap({ ref: "t7k", id: "1", replies: [] }),
    authorMode: "assistant",
    ...overrides,
  });
  const parsed = parseWordCommentChanges({ changes }, ctx.rowCap);
  if (!parsed.ok) throw new Error("parse");
  const validated = validateWordCommentChanges(parsed, ctx);
  if (!validated.ok) throw new Error(JSON.stringify(validated.errors));
  return validated.draft;
}

const plan = (
  draft: ReturnType<typeof draftOf>,
  host: "PC" | "Mac" | "OfficeOnline" = "PC",
  tracking: "on" | "off" | "unknown" = "off",
  principalName: string | null = "Daniel Fiebig",
) =>
  wordCommentAuthorPlan(draft, {
    host,
    tracking,
    principalName,
    template: "Erato (AI) for {user}",
  });

afterEach(() => resetWordCommentSession());

describe("wordCommentAuthorPlan (O-28)", () => {
  const adds = [
    { op: "add", anchor: { para: 1, quote: "alpha" }, text: "a" },
    { op: "add", anchor: { para: 1, through: 2 }, text: "b" },
  ];

  it("names the AI author on desktop and keeps anchors across paragraphs under the user", () => {
    const result = plan(draftOf(adds));
    expect(result.authorName).toBe("Erato (AI) for Daniel Fiebig");
    expect([...result.userModeRows]).toEqual([[1, "anchor"]]);
  });

  it("posts every row as the user on the web, under Track Changes, or without a name", () => {
    expect([
      ...plan(draftOf(adds), "OfficeOnline").userModeRows.values(),
    ]).toEqual(["web", "web"]);
    expect([...plan(draftOf(adds), "PC", "on").userModeRows.values()]).toEqual([
      "tracking",
      "tracking",
    ]);
    expect(plan(draftOf(adds), "PC", "off", null)).toMatchObject({
      authorName: null,
    });
    noteWordCommentAssistantAuthorOff();
    expect([...plan(draftOf(adds)).userModeRows.values()][0]).toBe(
      "unavailable",
    );
  });

  it("leaves user mode and every other action alone", () => {
    expect(plan(draftOf(adds, { authorMode: "user" }))).toEqual({
      authorName: null,
      userModeRows: new Map(),
    });
    expect(
      plan(draftOf([{ op: "reply", thread: "t7k", text: "x" }])).authorName,
    ).toBeNull();
  });
});

describe("wordCommentAlwaysBlock", () => {
  it("blocks Always for adds after other people's comments or without a label, and only for adds", () => {
    const add = [{ op: "add", anchor: { para: 1 }, text: "a" }];
    expect(wordCommentAlwaysBlock(draftOf(add), true)).toBe("tainted");
    expect(wordCommentAlwaysBlock(draftOf(add, { label: "" }), false)).toBe(
      "empty-label",
    );
    expect(wordCommentAlwaysBlock(draftOf(add), false)).toBeNull();
    expect(
      wordCommentAlwaysBlock(draftOf([{ op: "resolve", thread: "t7k" }]), true),
    ).toBeNull();
  });
});

describe("wordCommentOutcomeRecord (D-42)", () => {
  it("keeps refs, codes and ids but no text, and no ids for a legacy file", () => {
    const draft = draftOf([
      { op: "add", anchor: { para: 1 }, text: "secret text" },
    ]);
    const record = wordCommentOutcomeRecord({
      draft,
      consent: "approved",
      consentKind: "click",
      authorModeRequested: "assistant",
      rows: [
        {
          i: 0,
          op: "add",
          status: "applied",
          commentId: "42",
          newRef: "t1a",
          author: "assistant",
          revert: {
            kind: "delete-comment",
            commentId: "42",
            content: "secret text",
            author: "x",
          },
        },
      ],
    });
    expect(record).toEqual({
      action: "word.add_comments",
      draftId: "call-1",
      host: "pc",
      consent: "approved",
      consentKind: "click",
      authorModeRequested: "assistant",
      authorModeApplied: "assistant",
      label: "Erato AI:",
      rows: [
        { i: 0, op: "add", status: "applied", newRef: "t1a", commentId: "42" },
      ],
    });
    expect(JSON.stringify(record)).not.toContain("secret");
    const legacy = wordCommentOutcomeRecord({
      draft: { ...draft, legacy: true },
      consent: "approved",
      consentKind: "click",
      authorModeRequested: null,
      rows: [{ i: 0, op: "add", status: "applied", commentId: "42" }],
    });
    expect(legacy.rows[0]).not.toHaveProperty("commentId");
  });
});
