import {
  noteWordCommentAssistantAuthorOff,
  wordCommentErrorCode,
} from "./wordCommentPolicy";
import {
  sameCommentText,
  WORD_COMMENT_RUN_TIMEOUT_MS,
} from "./wordCommentWrites";
import { resolveWordParagraphs } from "./wordParagraphResolver";
import { runWordGuarded } from "./wordRunGuard";
import { currentWordSelectionSupport } from "./wordSelectionSupport";
import { queueParagraphSpanChecks, readWordStory } from "./wordSelectionTarget";

import type { WordCommentDraftRow } from "./wordCommentChanges";
import type { WordCommentReattribute } from "./wordCommentWrites";

/**
 * O-28 AI-author mode: a comment Erato just posted under the user's name, with the label, is
 * re-attributed through its paragraph's own OOXML. Only that comment's w:author, w:initials and
 * label change; the package goes back with insertOoxml("Replace") under the proofs of a v2
 * kept-item write, and a fresh run verifies it. Anything short of that leaves the labelled
 * comment as it was, which the row reports as applied_as_user (P-AUTH-1, P-AUTH-4).
 */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const W16CID = "http://schemas.microsoft.com/office/word/2016/wordml/cid";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";

function part(doc: Document, name: string): Element | null {
  const found = Array.from(doc.getElementsByTagNameNS(PKG, "part")).find(
    (p) =>
      (p.getAttributeNS(PKG, "name") ?? p.getAttribute("pkg:name")) === name,
  );
  return (
    found?.getElementsByTagNameNS(PKG, "xmlData")[0]?.firstElementChild ?? null
  );
}

/**
 * The package with each target comment's author set to `author`, its initials to "AI" and the
 * label taken off the front of its text; null when any target is missing or does not start with
 * the label, so nothing is written at all.
 */
export function wordCommentPackageWithAuthor(
  ooxml: string,
  targets: readonly { commentId: string; label: string }[],
  author: string,
): string | null {
  const doc = new DOMParser().parseFromString(ooxml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return null;
  const ids = part(doc, "/word/commentsIds.xml");
  const comments = part(doc, "/word/comments.xml");
  if (!ids || !comments) return null;
  const paraIds = new Map(
    Array.from(ids.getElementsByTagNameNS(W16CID, "commentId"), (entry) => [
      String(parseInt(entry.getAttributeNS(W16CID, "durableId") ?? "", 16)),
      (entry.getAttributeNS(W16CID, "paraId") ?? "").toUpperCase(),
    ]),
  );
  const byParaId = new Map(
    Array.from(comments.getElementsByTagNameNS(W, "comment"), (comment) => {
      const paragraphs = comment.getElementsByTagNameNS(W, "p");
      const last = paragraphs[paragraphs.length - 1];
      return [
        (last?.getAttributeNS(W14, "paraId") ?? "").toUpperCase(),
        comment,
      ] as const;
    }),
  );
  for (const { commentId, label } of targets) {
    const paraId = paraIds.get(commentId);
    const comment = paraId ? byParaId.get(paraId) : undefined;
    if (!comment) return null;
    const prefix = label.trim() ? `${label.trim()} ` : "";
    const texts = Array.from(comment.getElementsByTagNameNS(W, "t"));
    if (
      !texts
        .map((t) => t.textContent ?? "")
        .join("")
        .startsWith(prefix)
    )
      return null;
    let left = prefix.length;
    for (const text of texts) {
      if (!left) break;
      const value = text.textContent ?? "";
      const cut = Math.min(left, value.length);
      text.textContent = value.slice(cut);
      left -= cut;
    }
    comment.setAttributeNS(W, "w:author", author);
    comment.setAttributeNS(W, "w:initials", "AI");
  }
  const serialized = new XMLSerializer().serializeToString(doc);
  const declaration = /^\s*<\?xml[^?]*\?>/.exec(ooxml)?.[0];
  return declaration && !serialized.startsWith("<?xml")
    ? declaration + serialized
    : serialized;
}

interface Snapshot {
  id: string;
  author: string;
  content: string;
}

const listed = (comments: Word.CommentCollection): Snapshot[] =>
  comments.items.map((c) => ({
    id: String(c.id),
    author: c.authorName,
    content: c.content,
  }));

type Outcome = {
  status: "applied" | "applied_as_user" | "unverified";
  code?: string;
};

async function reattributeParagraph(
  rows: readonly { row: WordCommentDraftRow; commentId: string }[],
  authorName: string,
  label: string,
): Promise<Outcome> {
  const add = rows[0].row.add!;
  const support = currentWordSelectionSupport();
  const asUser = (code: string): Outcome => ({
    status: "applied_as_user",
    code,
  });
  const write = await runWordGuarded(
    async (context, guard) => {
      const story = await readWordStory(context);
      const resolved = resolveWordParagraphs(add.anchor, story.entries);
      if ("refused" in resolved)
        return {
          kind: "done" as const,
          outcome: asUser("TARGET_TEXT_MISMATCH"),
        };
      const position = resolved.positions[0];
      // Desktop shows no comment mark in paragraph.text, so the insert left it as validated.
      if (story.rangeTexts[position] !== add.rangeTexts[0])
        return {
          kind: "done" as const,
          outcome: asUser("TARGET_TEXT_MISMATCH"),
        };
      const paragraph = story.items[position];
      const document = context.document;
      document.load("changeTrackingMode");
      const comments = document.body.getComments();
      comments.load("items/id,items/authorName,items/content");
      const checks = queueParagraphSpanChecks(
        paragraph,
        add.inTable,
        support.listsBookmarks,
      );
      await context.sync();
      // F-14: under Track Changes the rewrite would be the user's tracked insertion.
      if (document.changeTrackingMode !== "Off")
        return {
          kind: "done" as const,
          outcome: asUser("AUTHOR_MODE_UNAVAILABLE"),
        };
      const read = checks();
      const hazards = read.objectHazards;
      if (
        hazards.contentControl ||
        hazards.field ||
        hazards.trackedChange ||
        hazards.commentMark ||
        (read.bookmarks?.length ?? 0) > 0
      )
        return {
          kind: "done" as const,
          outcome: asUser("AUTHOR_MODE_UNAVAILABLE"),
        };
      const rewritten = wordCommentPackageWithAuthor(
        read.ooxml,
        rows.map(({ commentId }) => ({ commentId, label })),
        authorName,
      );
      if (!rewritten)
        return {
          kind: "done" as const,
          outcome: asUser("AUTHOR_MODE_UNAVAILABLE"),
        };
      const before = listed(comments);
      guard.beforeWrite();
      paragraph.insertOoxml(rewritten, "Replace");
      try {
        await context.sync();
      } catch (error) {
        // F-15: comments-only protection throws GeneralException here, read-only AccessDenied.
        const code = wordCommentErrorCode(error);
        if (code === "GeneralException" || code === "AccessDenied") {
          noteWordCommentAssistantAuthorOff();
          return {
            kind: "done" as const,
            outcome: asUser("AUTHOR_MODE_UNAVAILABLE"),
          };
        }
        return {
          kind: "written" as const,
          before,
          paragraphs: story.items.length,
        };
      }
      return {
        kind: "written" as const,
        before,
        paragraphs: story.items.length,
      };
    },
    { timeoutMs: WORD_COMMENT_RUN_TIMEOUT_MS },
  );
  if (write.outcome !== "ok" || !write.value)
    return write.writeQueued
      ? { status: "unverified", code: "AUTHOR_REWRITE_UNVERIFIED" }
      : asUser("AUTHOR_MODE_UNAVAILABLE");
  if (write.value.kind === "done") return write.value.outcome;
  const { before, paragraphs } = write.value;

  const check = await runWordGuarded(
    async (context) => {
      const story = await readWordStory(context);
      const comments = context.document.body.getComments();
      comments.load("items/id,items/authorName,items/content");
      await context.sync();
      const resolved = resolveWordParagraphs(add.anchor, story.entries);
      return {
        text:
          "positions" in resolved
            ? story.rangeTexts[resolved.positions[0]]
            : null,
        paragraphs: story.items.length,
        after: listed(comments),
      };
    },
    { timeoutMs: WORD_COMMENT_RUN_TIMEOUT_MS },
  );
  if (check.outcome !== "ok" || !check.value)
    return { status: "unverified", code: "AUTHOR_REWRITE_UNVERIFIED" };
  const { text, after } = check.value;
  const targets = new Set(rows.map(({ commentId }) => commentId));
  const others = (list: Snapshot[]) =>
    JSON.stringify(
      list
        .filter((c) => !targets.has(c.id))
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
  const intact =
    text === add.rangeTexts[0] &&
    check.value.paragraphs === paragraphs &&
    others(before) === others(after);
  const states = rows.map(({ row, commentId }) => {
    const found = after.filter((c) => c.id === commentId);
    if (found.length !== 1) return "missing";
    if (
      found[0].author === authorName &&
      sameCommentText(found[0].content, row.text!)
    )
      return "assistant";
    return sameCommentText(found[0].content, row.finalText!) ? "user" : "other";
  });
  if (intact && states.every((state) => state === "assistant"))
    return { status: "applied" };
  if (intact && states.every((state) => state === "user"))
    return asUser("AUTHOR_MODE_UNAVAILABLE");
  return { status: "unverified", code: "AUTHOR_REWRITE_UNVERIFIED" };
}

export const reattributeWordComments: WordCommentReattribute = async ({
  draft,
  rows,
  authorName,
}) => {
  const outcomes = new Map<number, Outcome>();
  const groups = new Map<
    string,
    { row: WordCommentDraftRow; commentId: string }[]
  >();
  for (const entry of rows) {
    const key = JSON.stringify(entry.row.add!.anchor.paragraphs);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  for (const group of groups.values()) {
    const outcome = await reattributeParagraph(group, authorName, draft.label);
    // A rewrite Word did not confirm is not tried again this session; a paragraph's own hazard is.
    if (outcome.status === "unverified") noteWordCommentAssistantAuthorOff();
    for (const { row } of group) outcomes.set(row.i, outcome);
  }
  return outcomes;
};
