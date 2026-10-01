import { parseWordDocumentPlan } from "./wordDocumentPlan";
import { parseWordEdits } from "./wordEditPlan";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanRun,
  WordSourceBlock,
} from "./wordDocumentPlan";
import type { WordEdit } from "./wordEditPlan";
import type { WordImageAsset, WordImageAssetIssue } from "./wordImageAssetData";
import type { WordSectionSource, WordStorySource } from "./wordStories";
import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

export const WORD_READ_TOOL = "read_document_blocks";
export const WORD_SUBMIT_PLAN_TOOL = "submit_document_plan";
export const WORD_SUBMIT_PLAN_ACTION = "word.apply_document_plan";
export const WORD_EDITS_FENCE = "erato-word-edits";

/**
 * A snapshot rebuilt from stored read outputs. It reviews what the model read,
 * but it has no document XML and never authorizes a write.
 */
export type WordHistorySnapshot = WordAuthoringSnapshot & { source: "history" };

export function isWordHistorySnapshot(
  snapshot: WordAuthoringSnapshot | undefined,
): snapshot is WordHistorySnapshot {
  return snapshot?.source === "history";
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

type HistoryMessage = Pick<Message, "content">;

/** The message and the ones before it on its branch, oldest first. */
export function wordMessageLineage(
  messages: Readonly<Record<string, Message | undefined>>,
  messageId: string | undefined,
): Message[] {
  const lineage: Message[] = [];
  const seen = new Set<string>();
  let id = messageId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const message = messages[id];
    if (!message) break;
    lineage.unshift(message);
    id = message.previous_message_id;
  }
  return lineage;
}

interface ReadPage {
  cursor: string | null;
  result: Record<string, unknown>;
}

function readPages(
  messages: readonly HistoryMessage[],
  snapshotId: string,
): ReadPage[] {
  return messages.flatMap(
    (message) =>
      (message.content as ContentPart[] | undefined)?.flatMap<ReadPage>(
        (part) => {
          if (
            part.content_type !== "tool_use" ||
            part.tool_name !== WORD_READ_TOOL ||
            part.status !== "success" ||
            !object(part.output) ||
            part.output.status !== "success" ||
            !object(part.output.result) ||
            part.output.result.snapshot !== snapshotId ||
            !Array.isArray(part.output.result.blocks)
          )
            return [];
          const input: Record<string, unknown> = object(part.input)
            ? part.input
            : {};
          // A scoped table-cell read discloses one cell, not the document.
          if ("table_cell" in input) return [];
          return [
            {
              cursor:
                typeof input.cursor === "string" && input.cursor
                  ? input.cursor
                  : null,
              result: part.output.result,
            },
          ];
        },
      ) ?? [],
  );
}

/** The newest read sequence that pages from its first page to completion. */
function completeRead(pages: readonly ReadPage[]): ReadPage[] | undefined {
  for (let start = pages.length - 1; start >= 0; start--) {
    if (pages[start].cursor !== null) continue;
    const chain = [pages[start]];
    let at = start;
    for (;;) {
      const { result } = chain[chain.length - 1];
      if (result.complete === true && result.nextCursor == null) return chain;
      const next = result.nextCursor;
      if (typeof next !== "string") break;
      const found = pages.findIndex((p, i) => i > at && p.cursor === next);
      if (found < 0) break;
      chain.push(pages[found]);
      at = found;
    }
  }
  return undefined;
}

interface Fragment extends Record<string, unknown> {
  ref: string;
  type: string;
  part: number;
  parts: number;
  text: string;
}

const isFragment = (value: unknown): value is Fragment =>
  object(value) &&
  typeof value.ref === "string" &&
  typeof value.type === "string" &&
  count(value.part) &&
  count(value.parts) &&
  value.part <= value.parts &&
  typeof value.text === "string";

const isRun = (value: unknown): value is WordPlanRun =>
  object(value) && typeof value.text === "string";
const sameFormat = (a: WordPlanRun, b: WordPlanRun) => {
  const { text: _a, ...left } = a;
  const { text: _b, ...right } = b;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        left[key as keyof typeof left] === right[key as keyof typeof right],
    )
  );
};

interface SourceRecord {
  base: Record<string, unknown>;
  text: string;
  runs?: WordPlanRun[];
  structure: Record<string, unknown>;
}

/** Inverts the reader's fragmenting: text pieces, their run slices and structureJson chunks. */
function reassemble(fragments: Fragment[]): SourceRecord | undefined {
  const parts = fragments[0].parts;
  const ordered = [...fragments].sort((a, b) => a.part - b.part);
  if (
    ordered.length !== parts ||
    ordered.some(
      (f, i) =>
        f.part !== i + 1 ||
        f.parts !== parts ||
        f.ref !== ordered[0].ref ||
        f.type !== ordered[0].type,
    )
  )
    return undefined;
  const structured = ordered.filter((f) => typeof f.structureJson === "string");
  const text = ordered.filter((f) => typeof f.structureJson !== "string");
  if (!text.length || text.length + structured.length !== parts)
    return undefined;
  if (structured.some((f, i) => f.part !== text.length + i + 1))
    return undefined;
  let structure: Record<string, unknown> = {};
  if (structured.length) {
    if (
      structured.some(
        (f, i) =>
          f.structurePart !== i + 1 || f.structureParts !== structured.length,
      )
    )
      return undefined;
    try {
      const parsed: unknown = JSON.parse(
        structured.map((f) => f.structureJson as string).join(""),
      );
      if (!object(parsed)) return undefined;
      structure = parsed;
    } catch {
      return undefined;
    }
  }
  let runs: WordPlanRun[] | undefined;
  for (const fragment of text) {
    if (fragment.runs === undefined) continue;
    const pieces: unknown = fragment.runs;
    if (!Array.isArray(pieces) || !pieces.every(isRun)) return undefined;
    runs ??= [];
    for (const [i, run] of pieces.entries()) {
      const last = runs[runs.length - 1];
      // The reader cuts a run at each fragment boundary; rejoin those pieces.
      if (i === 0 && last && fragment !== text[0] && sameFormat(last, run))
        runs[runs.length - 1] = { ...last, text: last.text + run.text };
      else runs.push({ ...run });
    }
  }
  const {
    part: _part,
    parts: _parts,
    text: _text,
    runs: _runs,
    ...base
  } = text[0];
  return {
    base,
    text: text.map((f) => f.text).join(""),
    ...(runs ? { runs } : {}),
    structure,
  };
}

/**
 * Rebuilds the source a plan was written against from the stored
 * `read_document_blocks` outputs for `snapshotId`, searching the given
 * messages (oldest first, ending with the plan's message). Returns undefined
 * unless one read sequence delivered every source record.
 */
export function wordSnapshotFromHistory(
  messages: readonly HistoryMessage[],
  snapshotId: string,
): WordHistorySnapshot | undefined {
  const chain = completeRead(readPages(messages, snapshotId));
  if (!chain) return undefined;
  const first = chain[0].result;
  const last = chain[chain.length - 1].result;
  const order: string[] = [];
  const byRef = new Map<string, Fragment[]>();
  for (const { result } of chain)
    for (const value of result.blocks as unknown[]) {
      if (!isFragment(value)) return undefined;
      const list = byRef.get(value.ref);
      if (list) list.push(value);
      else {
        order.push(value.ref);
        byRef.set(value.ref, [value]);
      }
    }
  if (
    !count(last.blocksTotal) ||
    order.length !== last.blocksTotal ||
    !Array.isArray(first.styles)
  )
    return undefined;
  const blocks: WordSourceBlock[] = [];
  const stories: WordStorySource[] = [];
  let sections: WordSectionSource[] | undefined;
  for (const ref of order) {
    const record = reassemble(byRef.get(ref)!);
    if (!record) return undefined;
    const { base, text, runs, structure } = record;
    if (base.type === "story") {
      const { story } = structure;
      if (!object(story)) return undefined;
      stories.push({
        ...(story as Omit<WordStorySource, "xml" | "part">),
        text,
        xml: "",
        part: "",
      });
    } else if (base.type === "sections") {
      if (!Array.isArray(structure.sections)) return undefined;
      sections = (structure.sections as unknown[]).map((section) => ({
        ...(section as Omit<WordSectionSource, "xml">),
        xml: "",
      }));
    } else {
      const { content, objects, format } = structure;
      blocks.push({
        ...(base as Omit<WordSourceBlock, "text" | "xml">),
        text,
        ...(runs ? { runs } : {}),
        ...(format !== undefined
          ? { format: format as WordSourceBlock["format"] }
          : {}),
        ...(content !== undefined
          ? { content: content as WordSourceBlock["content"] }
          : {}),
        ...(objects !== undefined
          ? { objects: objects as WordSourceBlock["objects"] }
          : {}),
        xml: "",
      });
    }
  }
  const assets = Array.isArray(first.assets)
    ? (first.assets as Omit<WordImageAsset, "fileId" | "base64">[]).map(
        (asset) => ({ ...asset, fileId: "", base64: "" }),
      )
    : [];
  const imageAssetIssues = Array.isArray(first.imageAssetIssues)
    ? (first.imageAssetIssues as Omit<WordImageAssetIssue, "fileId">[]).map(
        (issue) => ({ ...issue, fileId: "" }),
      )
    : [];
  return {
    source: "history",
    token: snapshotId,
    identity: "",
    ooxml: "",
    fingerprint: "",
    blocks,
    styles: first.styles as WordAuthoringSnapshot["styles"],
    ...(Array.isArray(first.preservedStories)
      ? { preservedStories: first.preservedStories as string[] }
      : {}),
    ...(first.fullDocument === true ? { fullDocument: true } : {}),
    ...(stories.length ? { stories } : {}),
    ...(sections ? { sections } : {}),
    assets,
    imageAssetIssues,
    read: new Set(order),
    ...(typeof last.readToken === "string"
      ? { readToken: last.readToken }
      : {}),
    revoked: true,
    used: true,
  };
}

export interface WordHistoryPlan {
  toolCallId: string;
  /** The materialized plan as JSON, as the plan fence carries it. */
  content: string;
  plan: WordDocumentPlan;
}

/**
 * The one accepted `submit_document_plan` call of a message. Concise
 * table-cell edits and draft repairs resolve to the complete plan the host
 * returned on acceptance; retries and failures never count.
 */
export function acceptedWordPlanFromHistory(
  content: readonly ContentPart[] | undefined,
): WordHistoryPlan | undefined {
  const accepted = (content ?? []).filter((part) => {
    if (
      part.content_type !== "tool_use" ||
      part.tool_name !== WORD_SUBMIT_PLAN_TOOL ||
      part.status !== "success" ||
      typeof part.tool_call_id !== "string" ||
      !part.tool_call_id
    )
      return false;
    const output = part.output;
    if (
      !object(output) ||
      output.status !== "success" ||
      !object(output.submission) ||
      output.submission.status !== "accepted" ||
      !object(output.result) ||
      !object(part.input)
    )
      return false;
    return (
      output.result.draft_id === part.tool_call_id &&
      output.result.snapshot === part.input.snapshot &&
      output.result.action === WORD_SUBMIT_PLAN_ACTION
    );
  });
  if (accepted.length !== 1) return undefined;
  const part = accepted[0];
  if (part.content_type !== "tool_use" || !part.tool_call_id) return undefined;
  const output = part.output;
  if (!object(output) || !object(output.result)) return undefined;
  const plan =
    object(part.input) &&
    ("draft_id" in part.input || "table_cell" in part.input)
      ? output.result.plan
      : part.input;
  if (
    !object(plan) ||
    plan.snapshot !== output.result.snapshot ||
    (object(part.input) && plan.readToken !== part.input.readToken)
  )
    return undefined;
  const contentJson = JSON.stringify(plan);
  const parsed = parseWordDocumentPlan(contentJson);
  if (!parsed) return undefined;
  return { toolCallId: part.tool_call_id, content: contentJson, plan: parsed };
}

export interface WordHistoryParagraph {
  /** As the request rendered it: line breaks folded, whitespace trimmed. */
  text: string;
  headingLevel?: number;
}

export interface WordHistoryEdits {
  edits: WordEdit[];
  /** The `[n]` lines the edits were written against, by ordinal. */
  paragraphs: ReadonlyMap<number, WordHistoryParagraph>;
  paragraphsSent?: number;
  paragraphsTotal?: number;
  /** A paragraph the request carried only in part. */
  partialOrdinal: number | null;
  documentName?: string;
}

const PARAGRAPH_LINE = /^\[(\d+)(?:\|H([1-9]))?\] (.*)$/u;
const FENCE = new RegExp(
  "```" + WORD_EDITS_FENCE + "[^\\S\\n]*\\n([\\s\\S]*?)\\n?```",
  "gu",
);

/** Parses the numbered `document_text` lines a Word request sent. */
export function wordParagraphsFromDocumentText(
  documentText: string | undefined,
): Map<number, WordHistoryParagraph> {
  const paragraphs = new Map<number, WordHistoryParagraph>();
  for (const line of (documentText ?? "").split("\n")) {
    const match = PARAGRAPH_LINE.exec(line);
    if (!match) continue;
    paragraphs.set(Number(match[1]), {
      text: match[3],
      ...(match[2] ? { headingLevel: Number(match[2]) } : {}),
    });
  }
  return paragraphs;
}

const nonNegative = (value: string | undefined) => {
  const parsed = value === undefined ? NaN : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

/** The first valid edits fence of an answer, with the paragraphs its request showed. */
export function wordEditsFromHistory(
  assistantText: string,
  previousUserMessage: Pick<Message, "action_facet_args"> | undefined,
): WordHistoryEdits | undefined {
  let edits: WordEdit[] | null = null;
  for (const match of assistantText.matchAll(FENCE)) {
    edits = parseWordEdits(match[1]);
    if (edits) break;
  }
  if (!edits) return undefined;
  const args = previousUserMessage?.action_facet_args ?? {};
  const partial = /^Paragraph (\d+) is included only in part/u.exec(
    args.truncation_note ?? "",
  );
  const paragraphsSent = nonNegative(args.paragraphs_sent);
  const paragraphsTotal = nonNegative(args.paragraphs_total);
  return {
    edits,
    paragraphs: wordParagraphsFromDocumentText(args.document_text),
    ...(paragraphsSent !== undefined ? { paragraphsSent } : {}),
    ...(paragraphsTotal !== undefined ? { paragraphsTotal } : {}),
    partialOrdinal: partial ? Number(partial[1]) : null,
    ...(args.document_name ? { documentName: args.document_name } : {}),
  };
}
