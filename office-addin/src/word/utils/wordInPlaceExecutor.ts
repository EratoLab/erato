import {
  packageStats,
  strictDifferingParts,
  wordDocumentDiagnostic as diagnostic,
} from "./wordApplyDiagnostics";
import {
  captureWordDocumentPackage,
  currentWordDocumentUrl,
  decodeWordInPlaceBackup,
  encodeWordDocumentBackup,
  supportsWordDocumentPackage,
  withWordInPlaceBackup,
} from "./wordDocumentPackage";
import { captureWordAuthoringSnapshot } from "./wordDocumentXml";
import { wordInPlaceCapabilities } from "./wordInPlaceCapabilities";
import { materializeWordInPlaceOps } from "./wordInPlacePlan";
import {
  WORD_SPAN_ENDING_MARKS,
  planWordSpanEdits,
  queueWordSpanEdits,
} from "./wordInPlaceSpanWriter";
import {
  decodeWordScopeFingerprint,
  encodeWordScopeFingerprint,
  verifyWordInPlaceOutput,
  verifyWordTrackedRevisions,
  wordFirstRunMarks,
  wordParagraphSignature,
} from "./wordInPlaceState";
import {
  isWordStoryOp,
  predictWordStoryParagraphs,
  wordStoryKey,
  wordStoryParagraphs,
  wordStoryUnchanged,
} from "./wordInPlaceStories";
import { isWordTrackingMode, latchWordInPlace } from "./wordInPlaceSwitch";
import {
  normalizeWordParagraphText,
  predictWordBodyParagraphs,
  wordParagraphAlignmentIssue,
} from "./wordLiveParagraphs";
import { rebaseWordSnapshot } from "./wordScopeGuard";
import { wordWriteHost } from "./wordWriteHost";

import type { WordDiagnosticDetails } from "./wordApplyDiagnostics";
import type {
  WordDocumentApplyResult,
  WordDocumentDiagnostic,
  WordDocumentRevertResult,
} from "./wordApplyDocumentPlan";
import type { WordApplyProgress } from "./wordApplyProgress";
import type {
  WordInPlaceBackup,
  WordInPlaceBackupOp,
  WordInPlaceRegion,
} from "./wordDocumentPackage";
import type { WordAuthoringSnapshot } from "./wordDocumentPlan";
import type {
  WordInPlaceMarks,
  WordInPlaceOp,
  WordInPlaceRun,
  WordInPlaceSlot,
  WordInPlaceState,
} from "./wordInPlacePlan";
import type { WordSpanEdit } from "./wordInPlaceSpanWriter";
import type { WordScopeEntry } from "./wordInPlaceState";
import type { WordStoryOp } from "./wordInPlaceStories";
import type { WordLiveParagraph } from "./wordLiveParagraphs";
import type { WordScopeRequest } from "./wordScopeGuard";

/** The prediction of body.paragraphs did not hold, a read only this route makes failed, or Track
 * Changes is on for a write tracked writing does not cover; nothing was written or saved yet. */
export interface WordInPlaceFallbackResult {
  fallback: "alignment" | "host-error" | "tracking";
  details: Pick<
    WordDiagnosticDetails,
    "paragraphs" | "locations" | "fallbackReasons"
  >;
}

const PARAGRAPH_FIELDS =
  "items/uniqueLocalId,items/tableNestingLevel,items/text";
const PLAIN: WordInPlaceMarks = {
  bold: false,
  italic: false,
  underline: false,
};

function liveParagraphs(
  collection: Word.ParagraphCollection,
): WordLiveParagraph[] {
  return collection.items.map((p) => ({
    id: p.uniqueLocalId,
    nesting: p.tableNestingLevel,
    text: p.text,
  }));
}

const sameLive = (a: WordLiveParagraph[], b: WordLiveParagraph[]) =>
  a.length === b.length &&
  a.every(
    (p, i) =>
      p.id === b[i].id && p.nesting === b[i].nesting && p.text === b[i].text,
  );

const sameRuns = (a: readonly WordInPlaceRun[], b: readonly WordInPlaceRun[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Each range inherits the marks of the run before it ("Replace" keeps the first run's), so a mark
 * is set only where the wanted value differs. */
export function queueWordInPlaceTextWrite(
  paragraph: Word.Paragraph,
  runs: readonly WordInPlaceRun[],
  inherited: WordInPlaceMarks,
): void {
  let previous = inherited;
  runs.forEach((run, index) => {
    const range = paragraph.insertText(
      run.text,
      index === 0 ? "Replace" : "End",
    );
    if (run.bold !== previous.bold) range.font.bold = run.bold;
    if (run.italic !== previous.italic) range.font.italic = run.italic;
    if (run.underline !== previous.underline)
      range.font.underline = run.underline ? "Single" : "None";
    previous = run;
  });
}

type Rewrite = Extract<WordInPlaceOp, { kind: "text" | "cell" }>;

function queueWrite(
  paragraph: Word.Paragraph,
  op: Rewrite,
  inherited: WordInPlaceMarks,
  direction: "apply" | "revert",
): void {
  if (op.kind === "cell")
    paragraph.insertText(
      direction === "apply" ? op.text : op.original,
      "Replace",
    );
  else if (direction === "revert" || !sameRuns(op.runs, op.original))
    queueWordInPlaceTextWrite(
      paragraph,
      direction === "apply" ? op.runs : op.original,
      inherited,
    );
}

interface ListState {
  isListItem: boolean;
  listId?: number;
}

function loadListState(paragraph: Word.Paragraph) {
  paragraph.load("isListItem");
  const list = paragraph.listOrNullObject;
  list.load("id");
  return (): ListState => ({
    isListItem: paragraph.isListItem,
    ...(list.isNullObject ? {} : { listId: list.id }),
  });
}

/** List membership first (Word may restyle while attaching or detaching), then the style itself. */
function queueState(
  paragraph: Word.Paragraph,
  current: ListState,
  target: WordInPlaceState,
  listId: number | undefined,
  relist = true,
): void {
  if (relist) {
    if (target.type === "list-item") {
      if (listId === undefined)
        throw new Error("The list to continue is no longer available.");
      const level = target.level ?? 0;
      if (!current.isListItem) paragraph.attachToList(listId, level);
      else if (current.listId !== listId) {
        paragraph.detachFromList();
        paragraph.attachToList(listId, level);
      } else paragraph.listItem.level = level;
    } else if (current.isListItem) paragraph.detachFromList();
  }
  if ("builtIn" in target.style)
    paragraph.styleBuiltIn = target.style
      .builtIn as Word.Paragraph["styleBuiltIn"];
  else paragraph.style = target.style.name;
}

/** Where a TrackedChange may lie relative to the paragraphs the write touched. */
const WITHIN = new Set(["Equal", "Inside", "InsideStart", "InsideEnd"]);
type Placement = ReturnType<Word.Range["compareLocationWith"]>;

/** Word coalesces adjacent revisions of one author and type, across paragraph marks too: a change
 * listed by a touched paragraph may reach into a neighbour, and rejecting it would undo that part. */
export function queueRevisionPlacements(
  changes: readonly Word.TrackedChange[],
  within: Word.Range,
): Placement[] {
  return changes.map((change) =>
    change.getRange("Whole").compareLocationWith(within),
  );
}

export const placedWithin = (placements: readonly Placement[]) =>
  placements.every((placement) => WITHIN.has(String(placement.value)));

/** The touched paragraphs of a region as one range, from its first to its last paragraph. */
const interiorRange = (first: Word.Paragraph, last: Word.Paragraph) =>
  first.getRange("Whole").expandTo(last.getRange("Whole"));

const sameRevisions = (
  live: readonly Word.TrackedChange[],
  recorded: readonly [string, string][] | undefined,
) =>
  !!recorded &&
  live.length === recorded.length &&
  live.every(
    (change, i) =>
      String(change.type) === recorded[i][0] && change.text === recorded[i][1],
  );

const relisted = (a: WordInPlaceState, b: WordInPlaceState) =>
  (a.type === "list-item") !== (b.type === "list-item") ||
  (a.type === "list-item" && (a.list !== b.list || a.level !== b.level));

const blockLocation = (ref: string, field: string) =>
  /^b\d{1,5}$/.test(ref)
    ? `/word/document.xml body block ${ref.slice(1)}: ${field}`
    : `/word/document.xml body: ${field}`;
const paragraphLocation = (index: number, field: string) =>
  `/word/document.xml paragraph ${index + 1}: ${field}`;
const storyLocation = (
  op: { story: { part: string }; paragraph: number },
  field: string,
) =>
  /^\/word\/[A-Za-z0-9_.-]{1,80}\.xml$/.test(op.story.part)
    ? `${op.story.part} paragraph ${op.paragraph + 1}: ${field}`
    : `/word story paragraph ${op.paragraph + 1}: ${field}`;
const MAX_LOCATIONS = 8;

/** Captured blocks and definitions the write depends on, for the scope-local stale check. A changed
 * style or list definition would change what a written paragraph reads as, so it counts as stale. */
function scopeRequest(
  ops: readonly WordInPlaceOp[],
  snapshot: WordAuthoringSnapshot,
  slots: readonly WordInPlaceSlot[],
): WordScopeRequest {
  const touched = new Set<string>();
  const definitions: { ref: string; style?: string; numId?: string }[] = [];
  const state = (
    ref: string,
    value: { styleRef?: string; list?: string; listRef?: string },
  ) => {
    if (value.listRef) touched.add(value.listRef);
    definitions.push({
      ref,
      ...(value.styleRef ? { style: value.styleRef } : {}),
      ...(value.list?.startsWith("existing-")
        ? { numId: value.list.slice("existing-".length) }
        : {}),
    });
  };
  for (const op of ops) {
    touched.add(op.ref);
    if (op.kind === "insert" || op.kind === "delete") state(op.ref, op.state);
    if (op.kind === "text") {
      const source = snapshot.blocks.find((b) => b.ref === op.ref);
      if (source) state(op.ref, source);
      if (op.restyle) {
        state(op.ref, op.restyle.from);
        state(op.ref, op.restyle.to);
      }
    }
  }
  const inserted = (slot: WordInPlaceSlot | undefined) =>
    slot?.kind === "op" && slot.op.kind === "insert";
  return {
    touched,
    definitions,
    edges: { start: inserted(slots[0]), end: inserted(slots.at(-1)) },
  };
}

interface Point {
  at: number;
  op: number;
}

/** Touched positions (written or deleted paragraphs) and insertion gaps between paragraphs, grouped
 * into regions bounded by untouched paragraphs. A region's boundaries are never written, so Restore
 * can find it again by their IDs. */
function regionsOf(
  ops: readonly WordInPlaceOp[],
  positions: readonly number[],
  count: number,
): { start: number; end: number; points: Point[] }[] {
  const points = ops
    .map((op, index) => {
      const at = positions[index];
      return {
        op: index,
        at:
          op.kind !== "insert"
            ? at
            : op.location === "After"
              ? at + 0.5
              : at - 0.5,
        // Inserted after the paragraph before a gap come first, as in the plan.
        rank: op.kind === "insert" && op.location === "Before" ? 1 : 0,
      };
    })
    .sort((a, b) => a.at - b.at || a.rank - b.rank || a.op - b.op);
  const regions: { start: number; end: number; points: Point[] }[] = [];
  for (const point of points) {
    const last = regions.at(-1);
    const previous = last?.points.at(-1);
    if (last && previous && !(Math.floor(previous.at) + 1 < point.at))
      last.points.push(point);
    else regions.push({ start: 0, end: 0, points: [point] });
  }
  for (const region of regions) {
    const first = region.points[0].at;
    const last = region.points.at(-1)!.at;
    region.start = Number.isInteger(first) ? first - 1 : Math.floor(first);
    region.end = Number.isInteger(last) ? last + 1 : Math.ceil(last);
    if (region.start < -1 || region.end > count)
      throw new Error("A touched paragraph lies outside the body.");
  }
  return regions;
}

const scopeOf = (
  regions: readonly WordInPlaceRegion[],
  signatures: ReadonlyMap<string, string>,
): string | undefined => {
  const entries: WordScopeEntry[] = [];
  for (const [index, region] of regions.entries())
    for (const id of region.after ?? []) {
      const signature = signatures.get(id);
      if (signature === undefined || !region.after) return undefined;
      entries.push([id, signature, index]);
    }
  return encodeWordScopeFingerprint(entries);
};

export interface WordInPlaceApplyInput {
  snapshot: WordAuthoringSnapshot;
  /** The dry-run compile of the plan, captured for verification. */
  compiled: WordAuthoringSnapshot;
  ops: readonly WordInPlaceOp[];
  onBeforeWrite?: (before: string) => void;
  progress: WordApplyProgress;
  /** Fresh read of the whole package after a rejected batch, when the touched paragraphs cannot be read. */
  observePackage: (documentUrl?: string) => Promise<string | undefined>;
}

/**
 * Writes the plan through the object model in two batches (text, inserts and deletes; then style and
 * list membership), after a sandwich read (paragraphs, exact .docx, paragraphs again) proves every
 * target is where the package says it is and that nothing the write depends on changed since the
 * capture. Changes elsewhere in the document are left as they are.
 */
export async function applyWordPlanInPlace(
  input: WordInPlaceApplyInput,
): Promise<WordDocumentApplyResult | WordInPlaceFallbackResult> {
  const { snapshot, compiled, onBeforeWrite, progress } = input;
  // Body ops index the body's paragraphs; story ops each name their own header or footer.
  const ops = input.ops.filter((op) => !isWordStoryOp(op));
  const storyOps = input.ops.filter(isWordStoryOp);
  const route = { route: "in-place" as const, inPlaceOps: input.ops.length };
  const host = wordWriteHost();
  if (!host || !supportsWordDocumentPackage())
    return {
      status: "blocked",
      diagnostic: diagnostic("preflight", "host-unavailable", undefined, route),
    };
  // Assigned inside the Word.run callback; the cast keeps TypeScript from narrowing it here.
  let stage = "preflight" as WordDocumentDiagnostic["stage"];
  let writing = false;
  let before: string | undefined;
  let documentUrl: string | undefined;
  let record: WordInPlaceBackup | undefined;
  let outside = 0;
  try {
    const snapshotSlots = materializeWordInPlaceOps(
      snapshot.blocks.map((b) => b.ref),
      ops,
    );
    if (!snapshotSlots) throw new Error("The in-place program is invalid.");
    const compiledIndex = new Map<WordInPlaceOp, number>();
    snapshotSlots.forEach((slot, i) => {
      if (slot.kind === "op") compiledIndex.set(slot.op, i);
    });
    const request = scopeRequest(ops, snapshot, snapshotSlots);
    progress.stage("backup");
    const stories = new Map(
      storyOps.map((op) => [wordStoryKey(op.story), op.story] as const),
    );
    return await host.run(async (context) => {
      context.document.load("changeTrackingMode");
      const first = context.document.body.paragraphs;
      first.load(PARAGRAPH_FIELDS);
      const sections = context.document.sections;
      if (stories.size) sections.load("items");
      await context.sync();
      const tracking = String(context.document.changeTrackingMode);
      const caps = wordInPlaceCapabilities();
      // The user's own mode decides how the write lands; it is read, never set.
      const trackedWrite = isWordTrackingMode(tracking) && caps.tracked;
      const liveA = liveParagraphs(first);
      const storyFirst = new Map(
        [...stories].map(([key, target]) => {
          const paragraphs = wordStoryParagraphs(sections, target);
          paragraphs.load(PARAGRAPH_FIELDS);
          return [key, paragraphs] as const;
        }),
      );
      if (stories.size) await context.sync();
      const storyA = new Map(
        [...storyFirst].map(([key, list]) => [key, liveParagraphs(list)]),
      );
      const live = await captureWordDocumentPackage();
      documentUrl = live.documentUrl;
      const urlChanged =
        (snapshot.documentUrl !== undefined &&
          live.documentUrl !== snapshot.documentUrl) ||
        currentWordDocumentUrl() !== live.documentUrl;
      const reason =
        snapshot.used || snapshot.revoked
          ? "expired"
          : tracking !== "Off" && !trackedWrite
            ? "tracking"
            : urlChanged
              ? "source-changed"
              : null;
      if (reason)
        return {
          status: "stale",
          diagnostic: diagnostic(
            "preflight",
            reason,
            undefined,
            reason === "source-changed" ? { ...route, urlChanged } : route,
          ),
        };
      // Captured without Track Changes, the plan may hold changes tracked writing does not cover yet.
      if (
        trackedWrite &&
        !caps.trackedStructure &&
        ops.some(
          (op) =>
            op.kind === "insert" ||
            op.kind === "delete" ||
            (op.kind === "text" && op.restyle),
        )
      )
        return { fallback: "tracking", details: {} };
      const rebase = rebaseWordSnapshot(snapshot, live, request);
      if (!rebase.ok)
        return {
          status: "stale",
          diagnostic: diagnostic("preflight", "source-changed", undefined, {
            ...route,
            ...strictDifferingParts(snapshot.ooxml, live.ooxml),
            locations: rebase.locations,
            ...packageStats([
              ["source", snapshot.ooxml],
              ["live", live.ooxml],
            ]),
          }),
        };
      const changedStory = storyOps.find(
        (op) =>
          !wordStoryUnchanged(snapshot.ooxml, live.ooxml, op.story, op.ref),
      );
      if (changedStory)
        return {
          status: "stale",
          diagnostic: diagnostic("preflight", "source-changed", undefined, {
            ...route,
            locations: [storyLocation(changedStory, "changed")],
          }),
        };
      const base = rebase.live;
      outside = rebase.outsideChanges;
      const liveRef = (ref: string) => rebase.map.get(ref);
      const predicted = predictWordBodyParagraphs(live.ooxml);
      const fallback = (
        count?: number,
        locations: string[] = [],
      ): WordInPlaceFallbackResult => ({
        fallback: "alignment",
        details: {
          ...(count === undefined
            ? {}
            : { paragraphs: { predicted: predicted.length, live: count } }),
          ...(locations.length ? { locations } : {}),
        },
      });
      const firstOf = new Map<string, number>();
      predicted.forEach((p, i) => {
        if (!firstOf.has(p.ref)) firstOf.set(p.ref, i);
      });
      const at = (ref: string, paragraph = 0) => {
        const mapped = liveRef(ref);
        const index =
          mapped === undefined ? -1 : (firstOf.get(mapped) ?? -1) + paragraph;
        return predicted[index]?.ref === mapped &&
          predicted[index].index === paragraph
          ? index
          : -1;
      };
      const positions = ops.map((op) => at(op.ref, op.paragraph));
      const listRefs = [
        ...new Set(
          ops.flatMap((op) =>
            op.kind === "insert"
              ? [op.state.listRef]
              : op.kind === "delete"
                ? [op.state.listRef]
                : op.kind === "text" && op.restyle
                  ? [op.restyle.from.listRef, op.restyle.to.listRef]
                  : [],
          ),
        ),
      ].filter((ref): ref is string => !!ref);
      const listAt = new Map(listRefs.map((ref) => [ref, at(ref)]));
      if (positions.some((p) => p < 0) || [...listAt.values()].includes(-1))
        return fallback();
      const structural = wordParagraphAlignmentIssue(predicted, liveA, []);
      if (structural)
        return fallback(
          liveA.length,
          structural.index === undefined
            ? []
            : [paragraphLocation(structural.index, structural.issue)],
        );
      const storyPredicted = new Map(
        [...stories].map(([key, target]) => [
          key,
          predictWordStoryParagraphs(live.ooxml, target.part),
        ]),
      );
      for (const [key, list] of storyPredicted) {
        const issue = wordParagraphAlignmentIssue(list, storyA.get(key)!, []);
        if (issue)
          return fallback(undefined, [
            storyLocation(
              storyOps.find((op) => wordStoryKey(op.story) === key)!,
              issue.issue,
            ),
          ]);
      }
      if (
        storyOps.some(
          (op) =>
            op.paragraph >= storyPredicted.get(wordStoryKey(op.story))!.length,
        )
      )
        return fallback();
      const regions = regionsOf(ops, positions, predicted.length);
      const checked = new Set<number>();
      for (const block of base.blocks)
        if (block.type !== "native" && firstOf.has(block.ref))
          checked.add(firstOf.get(block.ref)!);
      for (const region of regions)
        for (let i = region.start; i <= region.end; i++)
          if (i >= 0 && i < predicted.length) checked.add(i);
      const second = context.document.body.paragraphs;
      second.load(PARAGRAPH_FIELDS);
      const proxies = first.items.slice();
      const storySecond = new Map(
        [...stories].map(([key, target]) => {
          const paragraphs = wordStoryParagraphs(sections, target);
          paragraphs.load(PARAGRAPH_FIELDS);
          return [key, paragraphs] as const;
        }),
      );
      const storyProxy = (op: WordStoryOp) =>
        storyFirst.get(wordStoryKey(op.story))!.items[op.paragraph];
      const storyReads = storyOps.map((op) => storyProxy(op).getOoxml());
      const storyRanges = storyOps.map((op) => {
        if (!trackedWrite || !caps.span) return undefined;
        const ranges = storyProxy(op).getTextRanges(
          WORD_SPAN_ENDING_MARKS,
          false,
        );
        ranges.load("items/text");
        return ranges;
      });
      const readOps = ops.map((op, i) =>
        op.kind === "insert" ? undefined : proxies[positions[i]].getOoxml(),
      );
      const textRanges = ops.map((op, i) => {
        if (!trackedWrite || !caps.span) return undefined;
        if (op.kind !== "cell" && op.kind !== "text") return undefined;
        const ranges = proxies[positions[i]].getTextRanges(
          WORD_SPAN_ENDING_MARKS,
          false,
        );
        ranges.load("items/text");
        return ranges;
      });
      const cells = ops.map((op, i) => {
        if (op.kind !== "cell") return undefined;
        const cell = proxies[positions[i]].parentTableCellOrNullObject;
        cell.load("rowIndex,cellIndex");
        return cell;
      });
      // A neighbour with pending revisions next to a tracked insertion or deletion may merge with it
      // into one TrackedChange, which Restore could not reject without undoing the neighbour.
      const boundaryChanges = trackedWrite
        ? [
            ...new Set(
              regions
                .filter((region) =>
                  region.points.some((point) =>
                    ["insert", "delete"].includes(ops[point.op].kind),
                  ),
                )
                .flatMap((region) => [region.start, region.end])
                .filter((at) => at >= 0 && at < predicted.length),
            ),
          ].map((at) => {
            const changes = proxies[at].getTrackedChanges();
            changes.load("items/type");
            return changes;
          })
        : [];
      // Restore rejects every change in a written paragraph, so it must hold only this write's.
      const targetChanges = trackedWrite
        ? [
            ...ops.flatMap((op, i) =>
              op.kind === "insert" ? [] : [proxies[positions[i]]],
            ),
            ...storyOps.map(storyProxy),
          ].map((paragraph) => {
            const changes = paragraph.getTrackedChanges();
            changes.load("items/type");
            return changes;
          })
        : [];
      const joined = new Map(
        ops.flatMap((op) => {
          const ref =
            op.kind === "insert"
              ? op.state.listRef
              : op.kind === "text"
                ? op.restyle?.to.listRef
                : undefined;
          if (!ref) return [];
          const list = proxies[listAt.get(ref)!].listOrNullObject;
          list.load("id");
          return [[ref, list] as const];
        }),
      );
      await context.sync();
      const liveB = liveParagraphs(second);
      const storyB = new Map(
        [...storySecond].map(([key, list]) => [key, liveParagraphs(list)]),
      );
      if (
        !sameLive(liveA, liveB) ||
        [...storyA].some(([key, a]) => !sameLive(a, storyB.get(key)!))
      )
        return {
          status: "stale",
          diagnostic: diagnostic("preflight", "source-changed", undefined, {
            ...route,
            paragraphs: { predicted: predicted.length, live: liveB.length },
          }),
        };
      // Equal reads around the capture rule out typing: a text difference is the prediction's or the
      // host's Paragraph.text, which the import does not depend on.
      const textIssue = wordParagraphAlignmentIssue(predicted, liveB, checked);
      if (textIssue)
        return fallback(
          liveB.length,
          textIssue.index === undefined
            ? []
            : [paragraphLocation(textIssue.index, textIssue.issue)],
        );
      for (const [key, list] of storyPredicted) {
        const near = new Set(
          storyOps
            .filter((op) => wordStoryKey(op.story) === key)
            .flatMap((op) => [op.paragraph - 1, op.paragraph, op.paragraph + 1])
            .filter((i) => i >= 0 && i < list.length),
        );
        const issue = wordParagraphAlignmentIssue(list, storyB.get(key)!, near);
        if (issue)
          return fallback(undefined, [
            storyLocation(
              storyOps.find((op) => wordStoryKey(op.story) === key)!,
              issue.issue,
            ),
          ]);
      }
      const misplaced = ops.findIndex((op, i) => {
        const cell = cells[i];
        return (
          op.kind === "cell" &&
          (!cell ||
            cell.isNullObject ||
            cell.rowIndex !== op.rowIndex ||
            cell.cellIndex !== op.cellIndex ||
            liveB[positions[i]].nesting !== 1)
        );
      });
      if (misplaced >= 0)
        return fallback(liveB.length, [
          blockLocation(ops[misplaced].ref, "cell"),
        ]);
      if ([...joined.values()].some((list) => list.isNullObject))
        return fallback(liveB.length, ["/word/document.xml body: list"]);
      if (targetChanges.some((changes) => changes.items.length))
        return {
          fallback: "tracking",
          details: { fallbackReasons: ["native-target"] },
        };
      if (boundaryChanges.some((changes) => changes.items.length))
        return {
          fallback: "tracking",
          details: { fallbackReasons: ["boundary"] },
        };
      const listIds = new Map([...joined].map(([ref, list]) => [ref, list.id]));
      // Under Track Changes each changed word becomes its own revision; a paragraph whose ranges do
      // not rejoin to its text is rewritten whole, which still verifies.
      const spans: (WordSpanEdit[] | undefined)[] = ops.map((op, i) => {
        const ranges = textRanges[i];
        if (!ranges || (op.kind !== "text" && op.kind !== "cell"))
          return undefined;
        const [original, target] =
          op.kind === "text"
            ? [op.original, op.runs]
            : [
                [{ text: op.original, ...PLAIN }],
                [{ text: op.text, ...PLAIN }],
              ];
        return planWordSpanEdits(
          ranges.items.map((range) => range.text),
          liveB[positions[i]].text ?? "",
          original,
          target,
        );
      });
      const recordOps: WordInPlaceBackupOp[] = ops.map((op, i) => {
        const read = readOps[i];
        const anchor =
          op.kind === "delete"
            ? op.state.listRef
            : op.kind === "text"
              ? op.restyle?.from.listRef
              : undefined;
        return {
          ...op,
          ...(read
            ? {
                id: liveB[positions[i]].id,
                originalSignature: wordParagraphSignature(read.value),
              }
            : {}),
          ...(anchor ? { listAnchor: liveB[listAt.get(anchor)!].id } : {}),
        };
      });
      const storySpans = storyOps.map((op, k) => {
        const ranges = storyRanges[k];
        return ranges
          ? planWordSpanEdits(
              ranges.items.map((range) => range.text),
              storyB.get(wordStoryKey(op.story))![op.paragraph].text ?? "",
              op.original,
              op.runs,
            )
          : undefined;
      });
      recordOps.push(
        ...storyOps.map((op, k) => ({
          ...op,
          id: storyB.get(wordStoryKey(op.story))![op.paragraph].id,
          originalSignature: wordParagraphSignature(storyReads[k].value),
        })),
      );
      const backupRegions: WordInPlaceRegion[] = regions.map((region) => ({
        start: region.start >= 0 ? liveB[region.start].id : null,
        end: region.end < liveB.length ? liveB[region.end].id : null,
        before: region.points
          .filter((p) => ops[p.op].kind !== "insert")
          .map((p) => p.op),
      }));
      const storyRegions: WordInPlaceRegion[] = storyOps.map((op, k) => ({
        story: op.story,
        start: null,
        end: null,
        before: [ops.length + k],
      }));
      if (
        regions.some(
          (region, r) =>
            backupRegions[r].before.length !== region.end - region.start - 1,
        )
      )
        throw new Error("A region holds a paragraph the write does not touch.");
      record = {
        v: 1,
        ops: recordOps,
        regions: [...backupRegions, ...storyRegions],
        ...(trackedWrite ? { tracked: true as const } : {}),
      };
      before = encodeWordDocumentBackup(live, record);
      onBeforeWrite?.(before);
      snapshot.used = true;
      stage = "write";
      progress.stage("writing");
      writing = true;
      const inherited = readOps.map((read) =>
        read ? wordFirstRunMarks(read.value) : PLAIN,
      );
      const made = new Map<number, Word.Paragraph>();
      for (const region of [...regions].reverse()) {
        const points = [...region.points].reverse();
        for (const { op: i } of points) {
          const op = ops[i];
          if (op.kind === "delete") proxies[positions[i]].delete();
        }
        for (const { op: i } of points) {
          const op = ops[i];
          if (op.kind !== "text" && op.kind !== "cell") continue;
          const span = spans[i];
          if (span)
            queueWordSpanEdits(
              proxies[positions[i]],
              textRanges[i]!.items,
              span,
            );
          else queueWrite(proxies[positions[i]], op, inherited[i], "apply");
        }
        let chain: { anchor: number; paragraph: Word.Paragraph } | undefined;
        for (const { op: i } of region.points) {
          const op = ops[i];
          if (op.kind !== "insert") continue;
          const anchor = positions[i];
          const next =
            op.location === "After" && chain?.anchor === anchor
              ? chain.paragraph.insertParagraph("", "After")
              : proxies[anchor].insertParagraph("", op.location);
          if (op.location === "After") chain = { anchor, paragraph: next };
          queueWordInPlaceTextWrite(next, op.runs, PLAIN);
          made.set(i, next);
        }
      }
      storyOps.forEach((op, k) => {
        const span = storySpans[k];
        if (span)
          queueWordSpanEdits(storyProxy(op), storyRanges[k]!.items, span);
        else
          queueWrite(
            storyProxy(op),
            op,
            wordFirstRunMarks(storyReads[k].value),
            "apply",
          );
      });
      await context.sync();
      const restyled = ops.flatMap((op, i) =>
        op.kind === "text" && op.restyle
          ? [{ i, paragraph: proxies[positions[i]], restyle: op.restyle }]
          : [],
      );
      const states = new Map<number, () => ListState>();
      for (const [i, paragraph] of made) {
        paragraph.load("uniqueLocalId");
        states.set(i, loadListState(paragraph));
      }
      for (const { i, paragraph } of restyled)
        states.set(i, loadListState(paragraph));
      if (states.size) {
        await context.sync();
        for (const [i, paragraph] of made) {
          const op = ops[i] as Extract<WordInPlaceOp, { kind: "insert" }>;
          queueState(
            paragraph,
            states.get(i)!(),
            op.state,
            op.state.listRef ? listIds.get(op.state.listRef) : undefined,
          );
        }
        for (const { i, paragraph, restyle } of restyled)
          queueState(
            paragraph,
            states.get(i)!(),
            restyle.to,
            restyle.to.listRef ? listIds.get(restyle.to.listRef) : undefined,
            relisted(restyle.from, restyle.to),
          );
        await context.sync();
      }
      stage = "verify";
      progress.stage("verifying");
      const storyAfter = storyOps.map((op) => {
        const paragraph = storyProxy(op);
        const changes = trackedWrite
          ? paragraph.getTrackedChanges()
          : undefined;
        changes?.load("items/type,items/text");
        return {
          ooxml: paragraph.getOoxml(),
          changes,
          ...(trackedWrite
            ? {
                current: paragraph.getReviewedText("Current"),
                original: paragraph.getReviewedText("Original"),
              }
            : {}),
        };
      });
      const signatures = new Map<string, string>();
      const trackedIssues: string[] = [];
      let trackedScope: { ids: string[]; touched: Set<string> } | undefined;
      if (trackedWrite) {
        // Tracked deletions stay in the body until reviewed, so the regions are read back whole.
        const reread = context.document.body.paragraphs;
        reread.load("items/uniqueLocalId");
        await context.sync();
        const items = reread.items.slice();
        const ids = items.map((p) => p.uniqueLocalId);
        const at = new Map(ids.map((id, i) => [id, i]));
        const located = locateRegions(backupRegions, ids);
        if ("missing" in located)
          throw new Error("A written region can no longer be found.");
        const reads = located.map((r) =>
          r.interior.map((id) => {
            const paragraph = items[at.get(id)!];
            const changes = paragraph.getTrackedChanges();
            changes.load("items/type,items/text");
            return { ooxml: paragraph.getOoxml(), changes };
          }),
        );
        const reviewed = ops.map((op, i) => {
          const id =
            op.kind === "insert"
              ? made.get(i)!.uniqueLocalId
              : recordOps[i].id!;
          const paragraph = items[at.get(id) ?? -1];
          return paragraph
            ? {
                id,
                current: paragraph.getReviewedText("Current"),
                original: paragraph.getReviewedText("Original"),
              }
            : { id };
        });
        await context.sync();
        const placements = located.map((r, i) => {
          if (!r.interior.length) return [];
          const within = interiorRange(
            items[at.get(r.interior[0])!],
            items[at.get(r.interior.at(-1)!)!],
          );
          return r.interior.flatMap((_, k) =>
            queueRevisionPlacements(reads[i][k].changes.items, within),
          );
        });
        const storyPlacements = storyOps.map((op, k) =>
          queueRevisionPlacements(
            storyAfter[k].changes!.items,
            storyProxy(op).getRange("Whole"),
          ),
        );
        await context.sync();
        if (!placements.every(placedWithin))
          trackedIssues.push("/word/document.xml: revisions");
        storyOps.forEach((op, k) => {
          if (!placedWithin(storyPlacements[k]))
            trackedIssues.push(storyLocation(op, "revisions"));
        });
        const revisions: Record<string, [string, string][]> = {};
        located.forEach((r, i) =>
          r.interior.forEach((id, k) => {
            signatures.set(id, wordParagraphSignature(reads[i][k].ooxml.value));
            revisions[id] = reads[i][k].changes.items.map((change) => [
              String(change.type),
              change.text,
            ]);
          }),
        );
        ops.forEach((op, i) => {
          const read = reviewed[i];
          const text = (runs: readonly WordInPlaceRun[]) =>
            runs.map((run) => run.text).join("");
          const [current, original] =
            op.kind === "text"
              ? [text(op.runs), text(op.original)]
              : op.kind === "cell"
                ? [op.text, op.original]
                : op.kind === "insert"
                  ? [text(op.runs), ""]
                  : ["", text(op.original)];
          if (
            !("current" in read) ||
            normalizeWordParagraphText(read.current!.value) !== current ||
            normalizeWordParagraphText(read.original!.value) !== original
          )
            trackedIssues.push(blockLocation(op.ref, "reviewed"));
        });
        record.ops = recordOps.map((op, i) => {
          if (i >= ops.length) return op;
          const id = reviewed[i].id;
          const afterSignature = signatures.get(id);
          return afterSignature ? { ...op, id, afterSignature } : { ...op, id };
        });
        record.regions = backupRegions.map((region, r) => ({
          ...region,
          after: located[r].interior,
        }));
        record.revisions = revisions;
        trackedScope = {
          ids,
          touched: new Set(located.flatMap((r) => r.interior)),
        };
      } else {
        const afterProxies = new Map<number, Word.Paragraph>();
        ops.forEach((op, i) => {
          if (op.kind === "insert") afterProxies.set(i, made.get(i)!);
          else if (op.kind !== "delete")
            afterProxies.set(i, proxies[positions[i]]);
        });
        const written = new Map(
          [...afterProxies].map(([i, p]) => [i, p.getOoxml()] as const),
        );
        await context.sync();
        record.ops = recordOps.map((op, i) => {
          const read = written.get(i);
          if (!read) return op;
          const id = op.kind === "insert" ? made.get(i)!.uniqueLocalId : op.id!;
          const afterSignature = wordParagraphSignature(read.value);
          signatures.set(id, afterSignature);
          return { ...op, id, afterSignature };
        });
        record.regions = backupRegions.map((region, r) => ({
          ...region,
          after: regions[r].points
            .filter((p) => ops[p.op].kind !== "delete")
            .map((p) => record!.ops[p.op].id!),
        }));
      }
      storyOps.forEach((op, k) => {
        const index = ops.length + k;
        const read = storyAfter[k];
        const id = recordOps[index].id!;
        const afterSignature = wordParagraphSignature(read.ooxml.value);
        signatures.set(id, afterSignature);
        record!.ops[index] = { ...record!.ops[index], afterSignature };
        if (!read.changes) return;
        record!.revisions = {
          ...record!.revisions,
          [id]: read.changes.items.map((change) => [
            String(change.type),
            change.text,
          ]),
        };
        const text = (runs: readonly WordInPlaceRun[]) =>
          runs.map((run) => run.text).join("");
        if (
          normalizeWordParagraphText(read.current!.value) !== text(op.runs) ||
          normalizeWordParagraphText(read.original!.value) !== text(op.original)
        )
          trackedIssues.push(storyLocation(op, "reviewed"));
      });
      record.regions = [
        ...record.regions.filter((region) => !region.story),
        ...storyRegions.map((region, k) => ({
          ...region,
          after: [recordOps[ops.length + k].id!],
        })),
      ];
      before = withWordInPlaceBackup(before, record);
      const afterFingerprint = scopeOf(record.regions, signatures);
      const after = await captureWordDocumentPackage();
      if (
        after.documentUrl !== live.documentUrl ||
        currentWordDocumentUrl() !== live.documentUrl
      ) {
        latchWordInPlace("verify-mismatch");
        return {
          status: "interrupted",
          before,
          afterFingerprint,
          diagnostic: diagnostic("verify", "output-mismatch", undefined, {
            ...route,
            urlChanged: true,
          }),
        };
      }
      context.document.load("changeTrackingMode");
      await context.sync();
      const trackingAfter = String(context.document.changeTrackingMode);
      const actual = captureWordAuthoringSnapshot(
        after.ooxml,
        snapshot.identity,
        trackingAfter,
        true,
        "verify",
      );
      const liveSlots = materializeWordInPlaceOps(
        base.blocks.map((b) => b.ref),
        ops,
        (op) => liveRef(op.ref),
      );
      const failed = (locations: string[]) => ({
        ok: false as const,
        locations,
        confined: false,
        blocks: [] as number[],
      });
      const verified =
        trackingAfter !== tracking
          ? failed(["/word/settings.xml: tracking-changed"])
          : !liveSlots
            ? failed(["/word/document.xml body: scope"])
            : trackedScope
              ? verifyWordTrackedRevisions({
                  slots: liveSlots,
                  stories: storyOps,
                  base,
                  snapshot,
                  compiled,
                  compiledIndex,
                  afterOoxml: after.ooxml,
                  ...trackedScope,
                })
              : verifyWordInPlaceOutput({
                  slots: liveSlots,
                  stories: storyOps,
                  base,
                  snapshot,
                  compiled,
                  compiledIndex,
                  after: actual,
                });
      const verification = trackedIssues.length
        ? failed(
            [
              ...trackedIssues,
              ...(verified.ok ? [] : verified.locations),
            ].slice(0, MAX_LOCATIONS),
          )
        : verified;
      if (!verification.ok) {
        latchWordInPlace("verify-mismatch");
        const mismatched = [
          ...new Set(
            verification.blocks.flatMap((i) => {
              const slot = liveSlots?.[i];
              return slot?.kind === "op" ? [ops.indexOf(slot.op)] : [];
            }),
          ),
        ].filter((i) => i >= 0);
        // Restore must not rely on the mechanism that just misbehaved, nor miss a change outside
        // the written paragraphs: it is the exact package restore, guarded by this package. A
        // tracked write is the exception: the package restore cannot run under Track Changes, nor
        // once Word noted the mode switch in settings.xml, while rejecting exactly the revisions
        // recorded here, paragraph by paragraph, can.
        if (verification.confined || mismatched.length)
          before = withWordInPlaceBackup(before, {
            ...record,
            ...(verification.confined ? { scopedFallback: true as const } : {}),
            ...(mismatched.length ? { mismatched } : {}),
          });
        return {
          status: "interrupted",
          before,
          afterFingerprint: record.tracked
            ? (afterFingerprint ?? after.fingerprint)
            : after.fingerprint,
          diagnostic: diagnostic("verify", "output-mismatch", undefined, {
            ...route,
            verifyTier: "block",
            locations: verification.locations,
            ...(outside ? { outsideChanges: outside } : {}),
            ...(actual.issue ? { snapshotIssue: actual.issue } : {}),
            ...packageStats([
              ["live", live.ooxml],
              ["actual", after.ooxml],
            ]),
          }),
        };
      }
      return {
        status: "applied",
        before,
        afterFingerprint,
        outcome: {
          route: "in-place",
          tier: "block",
          adjustments: [],
          ops: input.ops.length,
          ...(outside ? { outsideChanges: outside } : {}),
          ...(trackedWrite
            ? { tracked: true }
            : isWordTrackingMode(snapshot.trackingMode)
              ? { tracked: false }
              : {}),
        },
      };
    });
  } catch (error) {
    if (!writing && before === undefined) {
      // Paragraph collections, Paragraph.getOoxml and list lookups are reads the import never
      // makes; it runs its own preflight and reports a genuinely broken host itself.
      latchWordInPlace("host-error");
      return { fallback: "host-error", details: {} };
    }
    if (!writing)
      return {
        status: "blocked",
        diagnostic: diagnostic(stage, "host-error", error, route),
      };
    latchWordInPlace("interrupted");
    const observed =
      before && record
        ? await observeWordInPlace(record).catch(() => undefined)
        : undefined;
    if (observed && before)
      before = withWordInPlaceBackup(before, observed.record);
    return {
      status: "interrupted",
      before,
      afterFingerprint:
        observed?.afterFingerprint ?? (await input.observePackage(documentUrl)),
      diagnostic: diagnostic(stage, "host-error", error, {
        ...route,
        ...(observed && stage === "write" ? { partial: observed.partial } : {}),
        ...(outside ? { outsideChanges: outside } : {}),
      }),
    };
  }
}

interface LocatedRegion {
  region: WordInPlaceRegion;
  index: number;
  /** Positions of the boundaries; -1 and the paragraph count stand for the body's start and end. */
  start: number;
  end: number;
  interior: string[];
}

function locateRegions(
  regions: readonly WordInPlaceRegion[],
  ids: readonly string[],
): LocatedRegion[] | { missing: number } {
  const position = new Map(ids.map((id, i) => [id, i]));
  const located: LocatedRegion[] = [];
  for (const [index, region] of regions.entries()) {
    if (region.story) continue;
    const start = region.start === null ? -1 : position.get(region.start);
    const end = region.end === null ? ids.length : position.get(region.end);
    if (start === undefined || end === undefined || start >= end)
      return { missing: index };
    located.push({
      region,
      index,
      start,
      end,
      interior: ids.slice(start + 1, end),
    });
  }
  return located;
}

/** Fresh read of the touched regions after a rejected batch; never retries the write. */
async function observeWordInPlace(record: WordInPlaceBackup) {
  const host = wordWriteHost();
  if (!host) return undefined;
  return host.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items/uniqueLocalId");
    // Story paragraphs are read back to count what Word wrote. Only a tracked record keeps them:
    // untracked, the exact package restore covers headers and footers.
    const stories = record.regions.flatMap((region, index) => {
      const op = record.ops[region.before[0]];
      return region.story && op?.id
        ? [{ index, story: region.story, id: op.id }]
        : [];
    });
    const sections = context.document.sections;
    if (stories.length) sections.load("items");
    await context.sync();
    const storyLists = stories.map(({ story }) => {
      const list = wordStoryParagraphs(sections, story);
      list.load("items/uniqueLocalId");
      return list;
    });
    if (storyLists.length) await context.sync();
    const ids = paragraphs.items.map((p) => p.uniqueLocalId);
    const located = locateRegions(record.regions, ids);
    if ("missing" in located)
      throw new Error("A written region can no longer be found.");
    const storyParagraphs = stories.map(({ id }, k) =>
      storyLists[k].items.find((p) => p.uniqueLocalId === id),
    );
    if (record.tracked && storyParagraphs.some((paragraph) => !paragraph))
      throw new Error("A written story paragraph can no longer be found.");
    const reads = located.map((r) =>
      r.interior.map((_, k) => paragraphs.items[r.start + 1 + k].getOoxml()),
    );
    const trackedChanges = (paragraph: Word.Paragraph) => {
      const list = paragraph.getTrackedChanges();
      list.load("items/type,items/text");
      return list;
    };
    const changes = record.tracked
      ? located.map((r) =>
          r.interior.map((_, k) =>
            trackedChanges(paragraphs.items[r.start + 1 + k]),
          ),
        )
      : undefined;
    const storyReads = storyParagraphs.map((paragraph) =>
      paragraph
        ? {
            ooxml: paragraph.getOoxml(),
            changes: record.tracked ? trackedChanges(paragraph) : undefined,
          }
        : undefined,
    );
    await context.sync();
    const signatures = new Map<string, string>();
    const revisions: Record<string, [string, string][]> = {};
    const revisionsOf = (list: Word.TrackedChangeCollection) =>
      list.items.map(
        (change) => [String(change.type), change.text] as [string, string],
      );
    located.forEach((r, i) =>
      r.interior.forEach((id, k) => {
        signatures.set(id, wordParagraphSignature(reads[i][k].value));
        if (changes) revisions[id] = revisionsOf(changes[i][k]);
      }),
    );
    const storySignatures = new Map<string, string>();
    stories.forEach(({ id }, k) => {
      const read = storyReads[k];
      if (!read) return;
      storySignatures.set(id, wordParagraphSignature(read.ooxml.value));
      if (read.changes) revisions[id] = revisionsOf(read.changes);
    });
    if (record.tracked)
      for (const [id, signature] of storySignatures)
        signatures.set(id, signature);
    const ops = record.ops.map((op) =>
      op.id && signatures.has(op.id)
        ? { ...op, afterSignature: signatures.get(op.id) }
        : op,
    );
    const interiors = new Map<number, string[]>([
      ...located.map((r) => [r.index, r.interior] as [number, string[]]),
      ...(record.tracked ? stories : []).map(
        ({ index, id }) => [index, [id]] as [number, string[]],
      ),
    ]);
    const regions = record.regions.map((region, index) =>
      interiors.has(index)
        ? { ...region, after: interiors.get(index) }
        : region,
    );
    // Word runs a rejected batch's commands up to the rejection, so a region can be half written:
    // count per op. A paragraph that differs from its original or is gone was written; inserted
    // paragraphs have no ID in the record and are counted from the new IDs inside the regions.
    const known = new Set(record.ops.flatMap((op) => (op.id ? [op.id] : [])));
    const added = located
      .flatMap((r) => r.interior)
      .filter((id) => !known.has(id)).length;
    const written =
      record.ops.filter(
        (op) =>
          op.kind !== "insert" &&
          (signatures.get(op.id!) ?? storySignatures.get(op.id!)) !==
            op.originalSignature,
      ).length +
      Math.min(added, record.ops.filter((op) => op.kind === "insert").length);
    return {
      record: {
        ...record,
        ops,
        regions,
        ...(changes ? { revisions } : {}),
      },
      afterFingerprint: regions.some((region) => region.story && !region.after)
        ? undefined
        : scopeOf(regions, signatures),
      partial: { applied: written, untouched: record.ops.length - written },
    };
  });
}

/**
 * Undo an in-place write region by region. Each region must still hold exactly the paragraphs the
 * write left, each either as written or already back to its original, or exactly the original
 * paragraphs; anything else means a later edit, and nothing is written. Inserted paragraphs are
 * removed, rewritten ones restored and deleted ones re-created, and the result must equal the
 * original paragraphs signature for signature.
 */
export async function revertWordPlanInPlace(
  before: string,
  expectedAfter: string,
): Promise<WordDocumentRevertResult> {
  const route = { route: "in-place" as const };
  let backup: { documentUrl: string; inPlace?: WordInPlaceBackup };
  try {
    backup = decodeWordInPlaceBackup(before);
  } catch {
    return {
      status: "stale",
      diagnostic: diagnostic("preflight", "invalid", undefined, route),
    };
  }
  const expected = decodeWordScopeFingerprint(expectedAfter);
  const record = backup.inPlace;
  const host = wordWriteHost();
  if (!host)
    return {
      status: "stale",
      diagnostic: diagnostic("preflight", "host-unavailable", undefined, route),
    };
  if (
    !expected ||
    !record ||
    expected.some(([, , region]) => region >= record.regions.length)
  )
    return {
      status: "stale",
      diagnostic: diagnostic("preflight", "invalid", undefined, route),
    };
  const { ops, regions } = record;
  const details = { ...route, inPlaceOps: ops.length };
  const afterOf = (region: number) =>
    expected.filter(([, , r]) => r === region);
  const labelOf = (region: WordInPlaceRegion, index: number) =>
    ops[region.before[0]]?.ref ??
    ops.find(
      (op, i) =>
        op.kind === "insert" && afterOf(index).some(([id]) => id === op.id),
    )?.ref ??
    "";
  let stage: WordDocumentDiagnostic["stage"] = "preflight";
  let writing = false;
  const stale = (field: string, ref = "") => ({
    status: "stale" as const,
    diagnostic: diagnostic("preflight", "source-changed", undefined, {
      ...details,
      locations: [blockLocation(ref, field)],
    }),
  });
  const staleAt = (location: string) => ({
    status: "stale" as const,
    diagnostic: diagnostic("preflight", "source-changed", undefined, {
      ...details,
      locations: [location],
    }),
  });
  const observedScope = async () =>
    (await observeWordInPlace(record).catch(() => undefined))?.afterFingerprint;
  const storyEntries = regions.flatMap((region, index) => {
    const op = ops[region.before[0]];
    return region.story && op?.kind === "text" && op.story
      ? [{ index, op: op as WordStoryOp & WordInPlaceBackupOp }]
      : [];
  });
  try {
    return await host.run(async (context) => {
      if (currentWordDocumentUrl() !== backup.documentUrl)
        return {
          status: "stale",
          diagnostic: diagnostic("preflight", "source-changed", undefined, {
            ...details,
            urlChanged: true,
          }),
        };
      context.document.load("changeTrackingMode");
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items/uniqueLocalId");
      const sections = context.document.sections;
      if (storyEntries.length) sections.load("items");
      await context.sync();
      // Rewriting under Track Changes would add revisions; rejecting our own works in any mode.
      if (!record.tracked && context.document.changeTrackingMode !== "Off")
        return {
          status: "stale",
          diagnostic: diagnostic("preflight", "tracking", undefined, details),
        };
      const storyLists = new Map(
        storyEntries.map(({ op }) => {
          const list = wordStoryParagraphs(sections, op.story);
          list.load("items/uniqueLocalId");
          return [wordStoryKey(op.story), list] as const;
        }),
      );
      if (storyLists.size) await context.sync();
      const storyTargets: {
        index: number;
        op: WordStoryOp & WordInPlaceBackupOp;
        paragraph: Word.Paragraph;
      }[] = [];
      for (const { index, op } of storyEntries) {
        const paragraph = storyLists
          .get(wordStoryKey(op.story))!
          .items.find((p) => p.uniqueLocalId === op.id);
        if (!paragraph) return staleAt(storyLocation(op, "missing"));
        storyTargets.push({ index, op, paragraph });
      }
      // Copies: body.paragraphs is this same collection again later in the run, and its reload
      // replaces these items.
      const items = paragraphs.items.slice();
      const idsBefore = items.map((p) => p.uniqueLocalId);
      const position = new Map(idsBefore.map((id, i) => [id, i]));
      const located = locateRegions(regions, idsBefore);
      if ("missing" in located)
        return stale(
          "missing",
          labelOf(regions[located.missing], located.missing),
        );
      for (const r of located) {
        const afterIds = afterOf(r.index).map(([id]) => id);
        const beforeIds = r.region.before.map((i) => ops[i].id!);
        const same = (ids: string[]) =>
          ids.length === r.interior.length &&
          ids.every((id, k) => id === r.interior[k]);
        if (!same(afterIds) && !same(beforeIds))
          return stale("changed", labelOf(r.region, r.index));
      }
      const reads = located.map((r) =>
        r.interior.map((id) => items[position.get(id)!].getOoxml()),
      );
      const changes = record.tracked
        ? located.map((r) =>
            r.interior.map((id) => {
              const list = items[position.get(id)!].getTrackedChanges();
              list.load("items/type,items/text");
              return list;
            }),
          )
        : undefined;
      const boundaries = [
        ...new Set(
          located.flatMap((r) =>
            [r.start, r.end].filter((at) => at >= 0 && at < items.length),
          ),
        ),
      ];
      const boundaryReads = boundaries.map((at) => items[at].getOoxml());
      const storyReads = storyTargets.map(({ paragraph }) => {
        const changes = record.tracked
          ? paragraph.getTrackedChanges()
          : undefined;
        changes?.load("items/type,items/text");
        return { ooxml: paragraph.getOoxml(), changes };
      });
      const anchors = new Map(
        [
          ...new Set(
            ops.flatMap((op) => (op.listAnchor ? [op.listAnchor] : [])),
          ),
        ].flatMap((id) => {
          const at = position.get(id);
          if (at === undefined) return [];
          const list = items[at].listOrNullObject;
          list.load("id");
          return [[id, list] as const];
        }),
      );
      await context.sync();
      const pending: LocatedRegion[] = [];
      for (const [i, r] of located.entries()) {
        const afterSignatures = new Map(
          afterOf(r.index).map(([id, signature]) => [id, signature]),
        );
        const original = new Map(
          r.region.before.map((k) => [ops[k].id!, ops[k].originalSignature!]),
        );
        let changed = r.interior.length !== r.region.before.length;
        for (const [k, id] of r.interior.entries()) {
          const live = wordParagraphSignature(reads[i][k].value);
          if (live === original.get(id)) continue;
          // A reviewer who accepted or rejected one of these revisions already decided it.
          if (
            live !== afterSignatures.get(id) ||
            (changes &&
              !sameRevisions(changes[i][k].items, record.revisions?.[id]))
          )
            return stale("changed", labelOf(r.region, r.index));
          changed = true;
        }
        if (changed || r.region.before.some((k) => !position.has(ops[k].id!)))
          pending.push(r);
      }
      const storyPending: number[] = [];
      for (const [i, { index, op }] of storyTargets.entries()) {
        const live = wordParagraphSignature(storyReads[i].ooxml.value);
        if (live === op.originalSignature) continue;
        const changes = storyReads[i].changes;
        if (
          live !== afterOf(index).find(([id]) => id === op.id)?.[1] ||
          (changes && !sameRevisions(changes.items, record.revisions?.[op.id!]))
        )
          return staleAt(storyLocation(op, "changed"));
        storyPending.push(i);
      }
      if (changes) {
        const placements = pending.map((r) => {
          const i = located.indexOf(r);
          if (!r.interior.length) return [];
          const within = interiorRange(
            items[position.get(r.interior[0])!],
            items[position.get(r.interior.at(-1)!)!],
          );
          return r.interior.flatMap((_, k) =>
            queueRevisionPlacements(changes[i][k].items, within),
          );
        });
        const storyPlacements = storyPending.map((i) =>
          queueRevisionPlacements(
            storyReads[i].changes!.items,
            storyTargets[i].paragraph.getRange("Whole"),
          ),
        );
        if (placements.length || storyPlacements.length) await context.sync();
        const spilled = pending.find((_, k) => !placedWithin(placements[k]));
        if (spilled)
          return stale("revisions", labelOf(spilled.region, spilled.index));
        const story = storyPending.find(
          (_, k) => !placedWithin(storyPlacements[k]),
        );
        if (story !== undefined)
          return staleAt(storyLocation(storyTargets[story].op, "revisions"));
      }
      const restoredScope = (ids: Map<number, string[]>) =>
        encodeWordScopeFingerprint([
          ...located.flatMap((r) =>
            (ids.get(r.index) ?? r.region.before.map((k) => ops[k].id!)).map(
              (id, k) =>
                [
                  id,
                  ops[r.region.before[k]].originalSignature!,
                  r.index,
                ] as WordScopeEntry,
            ),
          ),
          ...storyTargets.map(
            ({ index, op }) =>
              [op.id!, op.originalSignature!, index] as WordScopeEntry,
          ),
        ]);
      const outcome = {
        route: "in-place" as const,
        tier: "block" as const,
        adjustments: [],
        ops: ops.length,
      };
      if (!pending.length && !storyPending.length)
        return {
          status: "reverted",
          afterFingerprint: restoredScope(new Map()),
          outcome,
        };
      const listIds = new Map<string, number>();
      for (const [id, list] of anchors)
        if (!list.isNullObject) listIds.set(id, list.id);
      const needsList = (op: WordInPlaceBackupOp) =>
        (op.kind === "delete" && op.state.type === "list-item") ||
        (op.kind === "text" &&
          !!op.restyle &&
          op.restyle.from.type === "list-item" &&
          relisted(op.restyle.from, op.restyle.to));
      if (!record.tracked)
        for (const r of pending)
          for (const k of r.region.before)
            if (
              needsList(ops[k]) &&
              (!ops[k].listAnchor || !listIds.has(ops[k].listAnchor))
            )
              return stale("list", ops[k].ref);
      stage = "restore";
      writing = true;
      const recreated = new Map<number, Word.Paragraph>();
      const restyle: { k: number; paragraph: Word.Paragraph }[] = [];
      // Only the revisions this write left, paragraph by paragraph from the end; the mode stays as is.
      if (changes)
        for (const r of [...pending].reverse()) {
          const i = located.indexOf(r);
          const original = new Map(
            r.region.before.map((k) => [ops[k].id!, ops[k].originalSignature!]),
          );
          for (let k = r.interior.length - 1; k >= 0; k--)
            if (
              original.get(r.interior[k]) !==
              wordParagraphSignature(reads[i][k].value)
            )
              changes[i][k].rejectAll();
        }
      for (const i of storyPending) {
        const { op, paragraph } = storyTargets[i];
        const read = storyReads[i];
        if (read.changes) read.changes.rejectAll();
        else
          queueWrite(
            paragraph,
            op,
            wordFirstRunMarks(read.ooxml.value),
            "revert",
          );
      }
      for (const r of changes ? [] : [...pending].reverse()) {
        const i = located.indexOf(r);
        const beforeIds = new Set(r.region.before.map((k) => ops[k].id!));
        r.interior
          .map((id, k) => ({ id, k }))
          .reverse()
          .forEach(({ id }) => {
            if (!beforeIds.has(id)) items[position.get(id)!].delete();
          });
        for (const k of r.region.before) {
          const op = ops[k];
          const at = r.interior.indexOf(op.id!);
          if (at < 0 || op.kind === "insert" || op.kind === "delete") continue;
          const live = wordParagraphSignature(reads[i][at].value);
          if (live === op.originalSignature) continue;
          const paragraph = items[position.get(op.id!)!];
          queueWrite(
            paragraph,
            op,
            wordFirstRunMarks(reads[i][at].value),
            "revert",
          );
          if (op.kind === "text" && op.restyle) restyle.push({ k, paragraph });
        }
        // Re-create deleted paragraphs in order, next to the paragraph before them or the one after.
        const sequence = r.region.before.map((k) => ({
          k,
          paragraph: r.interior.includes(ops[k].id!)
            ? items[position.get(ops[k].id!)!]
            : undefined,
        }));
        const startProxy = r.start >= 0 ? items[r.start] : undefined;
        const endProxy = r.end < items.length ? items[r.end] : undefined;
        for (let s = 0; s < sequence.length; s++) {
          if (sequence[s].paragraph) continue;
          const op = ops[sequence[s].k];
          if (op.kind !== "delete") continue;
          let paragraph: Word.Paragraph;
          if (op.recreate === "After") {
            const previous = s > 0 ? sequence[s - 1].paragraph : startProxy;
            if (!previous)
              throw new Error("A deleted paragraph has no anchor.");
            paragraph = previous.insertParagraph("", "After");
          } else {
            const next =
              sequence.slice(s + 1).find((entry) => entry.paragraph)
                ?.paragraph ?? endProxy;
            if (!next) throw new Error("A deleted paragraph has no anchor.");
            paragraph = next.insertParagraph("", "Before");
          }
          queueWordInPlaceTextWrite(paragraph, op.original, PLAIN);
          sequence[s].paragraph = paragraph;
          recreated.set(sequence[s].k, paragraph);
        }
      }
      await context.sync();
      const states = new Map<number, () => ListState>();
      for (const [k, paragraph] of recreated) {
        paragraph.load("uniqueLocalId");
        states.set(k, loadListState(paragraph));
      }
      for (const { k, paragraph } of restyle)
        states.set(k, loadListState(paragraph));
      if (states.size) {
        await context.sync();
        for (const [k, paragraph] of recreated) {
          const op = ops[k] as Extract<WordInPlaceBackupOp, { kind: "delete" }>;
          queueState(
            paragraph,
            states.get(k)!(),
            op.state,
            op.listAnchor ? listIds.get(op.listAnchor) : undefined,
          );
        }
        for (const { k, paragraph } of restyle) {
          const op = ops[k] as Extract<WordInPlaceBackupOp, { kind: "text" }>;
          queueState(
            paragraph,
            states.get(k)!(),
            op.restyle!.from,
            op.listAnchor ? listIds.get(op.listAnchor) : undefined,
            relisted(op.restyle!.from, op.restyle!.to),
          );
        }
        await context.sync();
      }
      stage = "verify";
      const restoredIds = new Map(
        pending.map((r) => [
          r.index,
          r.region.before.map((k) =>
            recreated.has(k) ? recreated.get(k)!.uniqueLocalId : ops[k].id!,
          ),
        ]),
      );
      const expectedIds = [...idsBefore];
      for (const r of [...pending].reverse())
        expectedIds.splice(
          r.start + 1,
          r.end - r.start - 1,
          ...restoredIds.get(r.index)!,
        );
      const recount = context.document.body.paragraphs;
      recount.load("items/uniqueLocalId");
      const restoredReads = pending.map((r) =>
        r.region.before.map((k, at) =>
          (
            recreated.get(k) ??
            items[position.get(restoredIds.get(r.index)![at])!]
          ).getOoxml(),
        ),
      );
      const boundariesAfter = boundaries.map((at) => items[at].getOoxml());
      const storyRestored = storyPending.map((i) =>
        storyTargets[i].paragraph.getOoxml(),
      );
      await context.sync();
      const moved = recount.items.findIndex(
        (p, i) => p.uniqueLocalId !== expectedIds[i],
      );
      const locations = [
        ...(recount.items.length !== expectedIds.length
          ? ["/word/document.xml body: count"]
          : moved >= 0
            ? [paragraphLocation(moved, "id")]
            : []),
        ...pending.flatMap((r, i) =>
          r.region.before
            .filter(
              (k, at) =>
                wordParagraphSignature(restoredReads[i][at].value) !==
                ops[k].originalSignature,
            )
            .map((k) => blockLocation(ops[k].ref, "signature")),
        ),
        ...boundaries
          .filter(
            (_, i) =>
              wordParagraphSignature(boundariesAfter[i].value) !==
              wordParagraphSignature(boundaryReads[i].value),
          )
          .map((at) => paragraphLocation(at, "signature")),
        ...storyPending
          .filter(
            (i, k) =>
              wordParagraphSignature(storyRestored[k].value) !==
              storyTargets[i].op.originalSignature,
          )
          .map((i) => storyLocation(storyTargets[i].op, "signature")),
      ];
      // No new scope fingerprint: another Restore would repeat what just misbehaved.
      if (locations.length)
        return {
          status: "interrupted",
          diagnostic: diagnostic("restore", "output-mismatch", undefined, {
            ...details,
            verifyTier: "block",
            locations: locations.slice(0, MAX_LOCATIONS),
          }),
        };
      return {
        status: "reverted",
        afterFingerprint: restoredScope(restoredIds),
        outcome,
      };
    });
  } catch (error) {
    return {
      status: writing ? "interrupted" : "stale",
      ...(writing ? { afterFingerprint: await observedScope() } : {}),
      diagnostic: diagnostic(stage, "host-error", error, details),
    };
  }
}

/** The scope a Restore falls back to when later edits keep the exact package restore from running,
 * for an unverified write whose differences all lie in the rewritten paragraphs. */
export function wordInPlaceFallbackScope(before: string): string | undefined {
  try {
    const record = decodeWordInPlaceBackup(before).inPlace;
    if (!record?.scopedFallback) return undefined;
    const signatures = new Map(
      record.ops.flatMap((op) =>
        op.id && op.afterSignature ? [[op.id, op.afterSignature] as const] : [],
      ),
    );
    return scopeOf(record.regions, signatures);
  } catch {
    return undefined;
  }
}
