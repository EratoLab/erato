import { wordBodyRefIndex } from "./wordBodyRef";
import {
  normalizeWordDocumentPlan,
  parseWordDocumentPlan,
} from "./wordDocumentPlan";
import { WORD_READ_TOOL, WORD_SUBMIT_PLAN_TOOL } from "./wordHistoryNames";
import { isAcceptedWordSubmission } from "./wordHistoryParts";
import {
  parseWordOutline,
  WORD_OUTLINE_TITLE_CHARS,
} from "./wordOutlineFormat";
import { wordReplayRecordRead } from "./wordReplayRecord";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanRun,
  WordSourceBlock,
} from "./wordDocumentPlan";
import type { WordEdit } from "./wordEditPlan";
import type { WordImageAsset, WordImageAssetIssue } from "./wordImageAssetData";
import type { WordParsedOutline } from "./wordOutlineFormat";
import type { WordSectionSource, WordStorySource } from "./wordStories";
import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

export {
  WORD_ACTION_FACET_IDS,
  WORD_EDITS_FENCE,
  WORD_INSERT_FENCE,
  WORD_PLAN_FENCE,
  WORD_PLAN_SECTIONS_TOOL,
  WORD_READ_TOOL,
  WORD_REPLACE_FENCE,
  WORD_SUBMIT_PLAN_ACTION,
  WORD_SUBMIT_PLAN_TOOL,
  WORD_WRITE_SECTION_TOOL,
} from "./wordHistoryNames";

export {
  isAcceptedWordSubmission,
  isRejectedWordSubmission,
  wordMessageLineage,
} from "./wordHistoryParts";

/**
 * What a snapshot rebuilt from section and target reads knows besides the
 * blocks those reads returned.
 */
export interface WordHistoryCoverage {
  /** Every body ref the plan, the reads and the request's outline name, in document order. */
  order: readonly string[];
  /** Where each section of the review starts, by ref, and the heading that titles it: none where no heading is sure. */
  headings: ReadonlyMap<string, { text: string; level?: number } | undefined>;
  /** Row and column titles of the cells read one by one, by `wordCellKey`. */
  cells?: ReadonlyMap<string, { rowLabel: string; header: string }>;
}

export const wordCellKey = (
  sourceRef: string,
  rowIndex: number,
  cellIndex: number,
) => `${sourceRef}:${rowIndex}:${cellIndex}`;

/**
 * A snapshot rebuilt from stored read outputs. It reviews what the model read,
 * but it has no document XML and never authorizes a write.
 */
export type WordHistorySnapshot = WordAuthoringSnapshot & {
  source: "history";
  /** Set when the turn read only parts of the document: `blocks` holds just those. */
  partial?: WordHistoryCoverage;
};

export function isWordHistorySnapshot(
  snapshot: WordAuthoringSnapshot | undefined,
): snapshot is WordHistorySnapshot {
  return snapshot?.source === "history";
}

export function wordHistoryCoverage(
  snapshot: WordAuthoringSnapshot | undefined,
): WordHistoryCoverage | undefined {
  return isWordHistorySnapshot(snapshot) ? snapshot.partial : undefined;
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

type HistoryMessage = Pick<Message, "content"> &
  Partial<Pick<Message, "action_facet_args">>;

interface StoredRead {
  input: Record<string, unknown>;
  result: Record<string, unknown>;
}

/** The pane runs a read sent as a replay record; its page is the read under `kept`. */
function storedReadInput(input: unknown): Record<string, unknown> {
  const { call } = wordReplayRecordRead(input);
  return object(call) ? call : {};
}

/** The successful `read_document_blocks` results for `snapshotId`, oldest first. */
function storedReads(
  messages: readonly HistoryMessage[],
  snapshotId: string,
): StoredRead[] {
  return messages.flatMap(
    (message) =>
      (message.content as ContentPart[] | undefined)?.flatMap<StoredRead>(
        (part) =>
          part.content_type !== "tool_use" ||
          part.tool_name !== WORD_READ_TOOL ||
          part.status !== "success" ||
          !object(part.output) ||
          part.output.status !== "success" ||
          !object(part.output.result) ||
          part.output.result.snapshot !== snapshotId
            ? []
            : [
                {
                  input: storedReadInput(part.input),
                  result: part.output.result,
                },
              ],
      ) ?? [],
  );
}

const PART_READS = ["section", "target", "table_cell"];

interface ReadPage {
  cursor: string | null;
  result: Record<string, unknown>;
}

function readPages(reads: readonly StoredRead[]): ReadPage[] {
  return reads.flatMap(({ input, result }) =>
    // Section, target and table-cell reads disclose parts, never the document.
    !Array.isArray(result.blocks) || PART_READS.some((key) => key in input)
      ? []
      : [
          {
            cursor:
              typeof input.cursor === "string" && input.cursor
                ? input.cursor
                : null,
            result,
          },
        ],
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

function bodyBlock({
  base,
  text,
  runs,
  structure,
}: SourceRecord): WordSourceBlock {
  const { content, objects, format } = structure;
  return {
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
  const chain = completeRead(readPages(storedReads(messages, snapshotId)));
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
    const { base, text, structure } = record;
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
    } else blocks.push(bodyBlock(record));
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

const isReadBlock = (
  value: unknown,
): value is Omit<WordSourceBlock, "xml"> & Record<string, unknown> =>
  object(value) &&
  typeof value.ref === "string" &&
  typeof value.type === "string" &&
  typeof value.text === "string";

/** A table-cell read returns a cell's titles as snippets: { text, truncated }. */
const snippetText = (value: unknown) =>
  object(value) && typeof value.text === "string"
    ? `${value.text}${value.truncated === true ? "…" : ""}`
    : undefined;

function requestOutline(
  messages: readonly HistoryMessage[],
  snapshotId: string,
): WordParsedOutline | undefined {
  const text = messages.findLast(
    (m) => m.action_facet_args?.document_snapshot === snapshotId,
  )?.action_facet_args?.heading_outline;
  return text ? parseWordOutline(text) : undefined;
}

interface ReviewHeading {
  text: string;
  level: number;
}

const outlineTitle = (title: string) =>
  Array.from(title).length >= WORD_OUTLINE_TITLE_CHARS ? `${title}…` : title;

/**
 * Where each section of a partly read review starts, by ref. An unread block may be a heading
 * below the levels the outline lists in full, so blocks after it go under the nearest heading they
 * surely belong to; a block with none starts a section without a title rather than a wrong one.
 */
function reviewSections(
  order: readonly string[],
  known: ReadonlyMap<string, WordSourceBlock | undefined>,
  outline: WordParsedOutline | undefined,
): Map<string, ReviewHeading | undefined> {
  const sections = new Map<string, ReviewHeading | undefined>();
  const positions = order.map(wordBodyRefIndex);
  const endsBefore = outline?.endsBefore
    ? (wordBodyRefIndex(outline.endsBefore) ?? -1)
    : Infinity;
  const listedCap = !outline
    ? 1
    : outline.shortened
      ? Math.max(0, ...[...outline.headings.values()].map((h) => h.level)) + 1
      : Infinity;
  /** The shallowest level an unread block at this index could be a heading at. */
  const capAt = (at: number) => (at < endsBefore ? listedCap : 1);
  const headingOf = (ref: string): ReviewHeading | undefined => {
    const block = known.get(ref);
    const listed = outline?.headings.get(ref);
    if (listed)
      return {
        text: block?.text.trim() ? block.text : outlineTitle(listed.title),
        level: listed.level,
      };
    return block?.type === "heading"
      ? { text: block.text, level: block.level ?? 1 }
      : undefined;
  };
  const open: ReviewHeading[] = [];
  let opening = true;
  const unread = (cap: number) => {
    while ((open.at(-1)?.level ?? 0) >= cap) open.pop();
    if (cap <= 1) opening = false;
  };
  let previous = -1;
  /** undefined: the opening content; null: no heading is sure. */
  let current: ReviewHeading | null | undefined;
  for (const [k, ref] of order.entries()) {
    const at = positions[k];
    if (at === undefined) return new Map([[order[0], undefined]]);
    if (at > previous + 1) unread(capAt(at - 1));
    previous = at;
    const heading = headingOf(ref);
    if (heading) {
      while ((open.at(-1)?.level ?? 0) >= heading.level) open.pop();
      open.push(heading);
      opening = false;
    } else if (!known.has(ref)) unread(capAt(at));
    const title = open.at(-1) ?? (opening ? undefined : null);
    if (title !== current) sections.set(ref, title ?? undefined);
    current = title;
  }
  return sections;
}

/**
 * The source of a plan whose turn read only parts of the document, as a
 * document too large for a complete read is read: the blocks its section and
 * target reads returned, and the headings that start each section of the
 * review. Undefined when the turn made no such read.
 */
function wordPartialSnapshotFromHistory(
  messages: readonly HistoryMessage[],
  plan: WordDocumentPlan,
): WordHistorySnapshot | undefined {
  const reads = storedReads(messages, plan.snapshot).filter(({ input }) =>
    PART_READS.some((key) => key in input),
  );
  if (!reads.length) return undefined;
  const blocks = new Map<string, WordSourceBlock>();
  const fragments = new Map<string, Map<number, Fragment>>();
  const styles = new Map<string, WordAuthoringSnapshot["styles"][number]>();
  /** Tables read only through a cell: not headings, though their blocks were not read. */
  const cellTables = new Set<string>();
  const cells = new Map<string, { rowLabel: string; header: string }>();
  for (const { input, result } of reads) {
    const cell = object(result.target) ? result.target : result.cell;
    if (
      "table_cell" in input &&
      result.status === "ready" &&
      object(cell) &&
      typeof cell.sourceRef === "string"
    ) {
      cellTables.add(cell.sourceRef);
      const found = (
        Array.isArray(result.candidates) ? (result.candidates as unknown[]) : []
      ).find(
        (c) =>
          object(c) &&
          c.sourceRef === cell.sourceRef &&
          c.rowIndex === cell.rowIndex &&
          c.cellIndex === cell.cellIndex,
      );
      const rowLabel = object(found) ? snippetText(found.rowLabel) : undefined;
      const header = object(found) ? snippetText(found.header) : undefined;
      if (
        rowLabel !== undefined &&
        header !== undefined &&
        typeof cell.rowIndex === "number" &&
        typeof cell.cellIndex === "number"
      )
        cells.set(wordCellKey(cell.sourceRef, cell.rowIndex, cell.cellIndex), {
          rowLabel,
          header,
        });
    }
    if ("section" in input && Array.isArray(result.blocks))
      for (const value of result.blocks as unknown[]) {
        if (isFragment(value)) {
          const parts = fragments.get(value.ref) ?? new Map();
          if (!parts.has(value.part)) parts.set(value.part, value);
          fragments.set(value.ref, parts);
        } else if (isReadBlock(value) && !blocks.has(value.ref))
          blocks.set(value.ref, { ...value, xml: "" });
      }
    if (
      !("target" in input) ||
      result.status !== "ready" ||
      !Array.isArray(result.targets)
    )
      continue;
    for (const target of result.targets as unknown[])
      if (
        object(target) &&
        target.objectTarget === undefined &&
        target.bodyRef === target.ref &&
        isReadBlock(target.content) &&
        target.content.ref === target.ref &&
        !blocks.has(target.content.ref)
      )
        blocks.set(target.content.ref, { ...target.content, xml: "" });
    for (const style of Array.isArray(result.styles) ? result.styles : [])
      if (
        object(style) &&
        typeof style.id === "string" &&
        typeof style.name === "string" &&
        !styles.has(style.id)
      )
        styles.set(
          style.id,
          style as unknown as WordAuthoringSnapshot["styles"][number],
        );
  }
  for (const [ref, parts] of fragments) {
    const record = blocks.has(ref)
      ? undefined
      : reassemble([...parts.values()]);
    if (record) blocks.set(ref, bodyBlock(record));
  }
  const outline = requestOutline(messages, plan.snapshot);
  const position = (ref: string) =>
    wordBodyRefIndex(ref) ?? Number.MAX_SAFE_INTEGER;
  const order = [
    ...new Set([
      ...plan.entries.flatMap((entry) =>
        entry.kind === "insert" ? [] : entry.source,
      ),
      ...plan.deleted.flatMap((deletion) => deletion.source),
      ...blocks.keys(),
      ...(outline?.headings.keys() ?? []),
    ]),
  ].sort((a, b) => position(a) - position(b));
  const known = new Map<string, WordSourceBlock | undefined>([
    ...[...cellTables].map((ref) => [ref, undefined] as const),
    ...blocks,
  ]);
  return {
    source: "history",
    token: plan.snapshot,
    identity: "",
    ooxml: "",
    fingerprint: "",
    blocks: order.flatMap((ref) => blocks.get(ref) ?? []),
    styles: [...styles.values()],
    assets: [],
    imageAssetIssues: [],
    read: new Set(blocks.keys()),
    revoked: true,
    used: true,
    partial: {
      order,
      headings: reviewSections(order, known, outline),
      cells,
    },
  };
}

export interface WordHistoryPlan {
  toolCallId: string;
  /** The materialized plan as JSON, as the plan fence carries it. */
  content: string;
  plan: WordDocumentPlan;
  /** See {@link wordPlanNotInProposal}. */
  notInProposal: string[];
}

/** How many left-out parts the card and the model's note name before "and other parts". */
export const MAX_NOT_IN_PROPOSAL_NAMES = 5;

/** The one accepted `submit_document_plan` call of a message and its receipt. */
function acceptedSubmission(content: readonly ContentPart[] | undefined) {
  const accepted = (content ?? []).filter(isAcceptedWordSubmission);
  const part = accepted.length === 1 ? accepted[0] : undefined;
  if (part?.content_type !== "tool_use") return undefined;
  const output = part.output;
  return object(output) && object(output.result)
    ? { part, result: output.result }
    : undefined;
}

/**
 * The one accepted `submit_document_plan` call of a message. Concise
 * table-cell edits, scoped edits and draft repairs resolve to the complete
 * plan the host returned on acceptance; retries and failures never count.
 */
export function acceptedWordPlanFromHistory(
  content: readonly ContentPart[] | undefined,
): WordHistoryPlan | undefined {
  const accepted = acceptedSubmission(content);
  const toolCallId = accepted?.part.tool_call_id;
  if (!accepted || !toolCallId) return undefined;
  const { part, result } = accepted;
  const plan =
    object(part.input) &&
    ("draft_id" in part.input ||
      "table_cell" in part.input ||
      "scoped_edit" in part.input)
      ? result.plan
      : part.input;
  if (
    !object(plan) ||
    plan.snapshot !== result.snapshot ||
    (object(part.input) && plan.readToken !== part.input.readToken)
  )
    return undefined;
  const contentJson = JSON.stringify(plan);
  const parsed = parseWordDocumentPlan(contentJson);
  if (!parsed) return undefined;
  return {
    toolCallId,
    content: contentJson,
    plan: parsed,
    notInProposal: wordPlanNotInProposal(content),
  };
}

/** The parts a smaller accepted retry left out, as the add-in's receipt names them; an empty name
 * stands for a part without text. */
export function wordPlanNotInProposal(
  content: readonly ContentPart[] | undefined,
): string[] {
  const names = acceptedSubmission(content)?.result.notInProposal;
  return Array.isArray(names)
    ? names.filter(
        (name): name is string =>
          typeof name === "string" && (name === "" || !!name.trim()),
      )
    : [];
}

export interface WordHistoryParagraph {
  /** As the request rendered it: line breaks folded, whitespace trimmed. */
  text: string;
  headingLevel?: number;
}

export interface WordHistoryEditSource {
  /** The `[n]` lines the edits were written against, by ordinal. */
  paragraphs: ReadonlyMap<number, WordHistoryParagraph>;
  paragraphsSent?: number;
  paragraphsTotal?: number;
  /** A paragraph the request carried only in part. */
  partialOrdinal: number | null;
  documentName?: string;
}

const PARAGRAPH_LINE = /^\[(\d+)(?:\|H([1-9]))?\] (.*)$/u;

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

/** The paragraphs a Word request showed, which its edits were written against. */
export function wordEditSourceFromHistory(
  previousUserMessage: Pick<Message, "action_facet_args"> | undefined,
): WordHistoryEditSource {
  const args = previousUserMessage?.action_facet_args ?? {};
  const partial = /^Paragraph (\d+) is included only in part/u.exec(
    args.truncation_note ?? "",
  );
  const paragraphsSent = nonNegative(args.paragraphs_sent);
  const paragraphsTotal = nonNegative(args.paragraphs_total);
  return {
    paragraphs: wordParagraphsFromDocumentText(args.document_text),
    ...(paragraphsSent !== undefined ? { paragraphsSent } : {}),
    ...(paragraphsTotal !== undefined ? { paragraphsTotal } : {}),
    partialOrdinal: partial ? Number(partial[1]) : null,
    ...(args.document_name ? { documentName: args.document_name } : {}),
  };
}

/**
 * The paragraphs the request covered: up to `paragraphs_sent`, or the last
 * ordinal it showed when the count is missing.
 */
export function wordEditWindow(source: WordHistoryEditSource): number {
  return source.paragraphsSent ?? Math.max(0, ...source.paragraphs.keys());
}

/**
 * The text an edit replaces, as its request showed it. The request omits
 * blank paragraphs, so an ordinal missing between two shown endpoints is a
 * blank line, as the add-in resolves it. Null when an endpoint was not shown,
 * the span leaves the window, or it covers the partly sent paragraph.
 */
export function wordEditOriginal(
  edit: WordEdit,
  source: WordHistoryEditSource,
): string | null {
  const through = edit.through ?? edit.paragraph;
  const { partialOrdinal } = source;
  if (
    through > wordEditWindow(source) ||
    !source.paragraphs.has(edit.paragraph) ||
    !source.paragraphs.has(through) ||
    (partialOrdinal !== null &&
      edit.paragraph <= partialOrdinal &&
      partialOrdinal <= through)
  )
    return null;
  const lines: string[] = [];
  for (let n = edit.paragraph; n <= through; n++)
    lines.push(source.paragraphs.get(n)?.text ?? "");
  return lines.join("\n");
}

export interface WordHistoryProposal {
  /** Normalised against the rebuilt snapshot, as the add-in reviews it. */
  plan: WordDocumentPlan;
  snapshot?: WordHistorySnapshot;
  documentName?: string;
  /** See {@link wordPlanNotInProposal}; only for a proposal read from a message's content. */
  notInProposal?: string[];
}

/**
 * The plan a Word chat proposed and the document it was written against, as
 * stored history shows them. `submitted` is either the plan message's content,
 * whose accepted submission counts, or a plan fence's JSON.
 */
export function wordHistoryProposal(
  lineage: readonly HistoryMessage[],
  submitted: readonly ContentPart[] | string,
): WordHistoryProposal | undefined {
  const accepted =
    typeof submitted === "string"
      ? undefined
      : acceptedWordPlanFromHistory(submitted);
  const plan =
    typeof submitted === "string"
      ? parseWordDocumentPlan(submitted)
      : accepted?.plan;
  if (!plan) return undefined;
  const snapshot =
    wordSnapshotFromHistory(lineage, plan.snapshot) ??
    wordPartialSnapshotFromHistory(lineage, plan);
  const documentName = lineage.findLast(
    (message) => message.action_facet_args?.document_name,
  )?.action_facet_args?.document_name;
  return {
    plan: normalizeWordDocumentPlan(plan, snapshot),
    ...(snapshot ? { snapshot } : {}),
    ...(documentName ? { documentName } : {}),
    ...(accepted?.notInProposal.length
      ? { notInProposal: accepted.notInProposal }
      : {}),
  };
}

const toolIdentity = (part: ContentPart): string =>
  part.content_type === "tool_use"
    ? [
        part.tool_call_id,
        part.status,
        object(part.output) ? part.output.status : "",
        object(part.output) && object(part.output.submission)
          ? part.output.submission.status
          : "",
      ].join(":")
    : "";

/**
 * Changes only when a read or submission that {@link wordHistoryProposal}
 * consumes starts or settles, so streamed text does not rebuild the proposal.
 */
export function wordHistoryProposalKey(
  lineage: readonly HistoryMessage[],
  content: readonly ContentPart[],
): string {
  const parts = (
    tool: string,
    messageContent: readonly ContentPart[] | undefined,
  ) =>
    (messageContent ?? [])
      .filter(
        (part) => part.content_type === "tool_use" && part.tool_name === tool,
      )
      .map(toolIdentity)
      .join(",");
  return [
    parts(WORD_SUBMIT_PLAN_TOOL, content),
    ...lineage.map((message) =>
      parts(WORD_READ_TOOL, message.content as ContentPart[] | undefined),
    ),
  ].join("|");
}
