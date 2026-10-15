import { wordParagraphAnchor } from "../../../word/utils/wordParagraphResolver";

import type {
  WordCommentStoryFacts,
  WordCommentValidationContext,
} from "../../../word/utils/wordCommentChanges";
import type {
  WordCommentEntryFingerprint,
  WordCommentRefEntry,
} from "../../../word/utils/wordCommentRefs";
import type { WordSelectionSnapshot } from "../../../word/utils/wordSelectionAnchor";

/** Refs and story facts for comment-change tests, without a Word host. */

export interface ThreadSpec {
  ref: string;
  id: string;
  author?: string;
  email?: string | null;
  content?: string;
  resolved?: boolean;
  /** Null: the replies were not read. */
  replies?:
    | { id: string; author?: string; email?: string | null; content?: string }[]
    | null;
  matchedBy?: "id" | "content";
  readOnly?: WordCommentRefEntry["readOnly"];
  para?: number;
}

const entryOf = (
  id: string,
  author = "Maya Krüger",
  email: string | null = "maya@contoso.test",
  content = `comment ${id}`,
): WordCommentEntryFingerprint => ({
  id,
  author,
  email,
  created: "2026-09-03T08:15:00.000Z",
  content,
});

export function threadEntry(spec: ThreadSpec): WordCommentRefEntry {
  const replies =
    spec.replies === null
      ? null
      : (spec.replies ?? []).map((reply) =>
          entryOf(reply.id, reply.author, reply.email, reply.content),
        );
  return {
    ref: spec.ref,
    commentId: spec.id,
    matchedBy: spec.matchedBy ?? "id",
    readOnly: spec.readOnly ?? null,
    fingerprint: {
      ...entryOf(spec.id, spec.author, spec.email, spec.content),
      resolved: spec.resolved ?? false,
      replyIds: replies?.map((reply) => reply.id) ?? null,
      replies,
      anchor: { para: spec.para ?? 1, quote: "anchor" },
    },
  };
}

export const threadMap = (...specs: ThreadSpec[]) =>
  new Map(specs.map((spec) => [spec.ref, threadEntry(spec)]));

export interface StoryParagraph {
  id?: string | null;
  text: string;
  /** paragraph.text when it differs from the identity text, as on the web or with tracked text. */
  rangeText?: string;
  nesting?: number;
}

export function storyFacts(
  paragraphs: readonly (string | StoryParagraph)[],
): WordCommentStoryFacts {
  const list = paragraphs.map((p, i) =>
    typeof p === "string" ? { id: `P${i + 1}`, text: p } : p,
  );
  return {
    entries: list.map((p, i) => ({
      id: p.id === undefined ? `P${i + 1}` : p.id,
      text: p.text,
    })),
    rangeTexts: list.map((p) => p.rangeText ?? p.text),
    nesting: list.map((p) => p.nesting ?? 0),
  };
}

export function selectionSnapshot(
  story: WordCommentStoryFacts,
  first: number,
  last: number,
  startOffset: number,
  endOffset: number,
  overrides: Partial<WordSelectionSnapshot> = {},
): WordSelectionSnapshot {
  const paragraphs = story.entries.slice(first, last + 1).map((entry, k) => ({
    id: entry.id,
    text: entry.text,
    rangeText: story.rangeTexts[first + k],
    index: first + k,
    styleName: "Normal",
    tableNestingLevel: story.nesting[first + k],
  }));
  const parts = paragraphs.map((p, k) =>
    p.rangeText.slice(
      k === 0 ? startOffset : 0,
      k === paragraphs.length - 1 ? endOffset : p.rangeText.length,
    ),
  );
  return {
    role: "rewrite",
    reasonCode: null,
    shape: last > first ? "multi_paragraph" : "inline",
    story: "main",
    origin: "user",
    selectedText: parts.join("\n"),
    truncated: false,
    paragraphCount: paragraphs.length,
    paragraphs,
    startOffset,
    endOffset,
    occurrence: 0,
    anchor: wordParagraphAnchor([...story.entries], first, last),
    contextBefore: "",
    contextAfter: "",
    ...overrides,
  };
}

export function validationContext(
  overrides: Partial<WordCommentValidationContext> = {},
): WordCommentValidationContext {
  return {
    draftId: "call-1",
    identity: "doc-1",
    host: "PC",
    threads: new Map(),
    selection: null,
    captured: new Map(),
    story: null,
    label: "Erato AI:",
    authorMode: "user",
    rowCap: () => 50,
    legacy: false,
    ...overrides,
  };
}
