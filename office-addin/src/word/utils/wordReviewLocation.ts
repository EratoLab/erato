import { planWordEdits } from "@erato/frontend/word-review";

import { wordHostPlatform } from "./wordHostPlatform";
import { wordParagraphId } from "./wordParagraphIds";
import {
  resolveWordParagraphs,
  wordParagraphAnchor,
} from "./wordParagraphResolver";
import { markProgrammaticWordSelection } from "./wordProgrammaticSelection";
import { wordWriteHost } from "./wordWriteHost";

import type { WordInPlaceBackup } from "./wordDocumentPackage";
import type {
  WordParagraphAnchor,
  WordParagraphEntry,
} from "./wordParagraphResolver";
import type {
  WordDocumentCapture,
  WordEdit,
} from "@erato/frontend/word-review";

export type WordTrackingMode = "off" | "on" | "unknown";
export interface WordReviewAnchor {
  identity: string;
  span: WordParagraphAnchor;
}
export type WordLocationResult =
  | "selected"
  | "cleared"
  | "changed"
  | "identity-mismatch"
  | "unavailable";

export async function readWordTrackingMode(): Promise<WordTrackingMode> {
  const word = wordWriteHost();
  if (!word) return "unknown";
  try {
    return await word.run(async (context) => {
      context.document.load("changeTrackingMode");
      await context.sync();
      const mode = context.document.changeTrackingMode;
      return mode === "Off"
        ? "off"
        : mode === "TrackAll" || mode === "TrackMineOnly"
          ? "on"
          : "unknown";
    });
  } catch {
    return "unknown";
  }
}

const captureBodies = new WeakMap<WordDocumentCapture, WordParagraphEntry[]>();

/** The captured body in document order; ordinals are dense from 1. */
function capturedBody(capture: WordDocumentCapture): WordParagraphEntry[] {
  let body = captureBodies.get(capture);
  if (!body) {
    body = [...capture.ordinalMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, p]) => ({ id: p.uniqueLocalId || null, text: p.text }));
    captureBodies.set(capture, body);
  }
  return body;
}

/** The span between two captured ordinals, inclusive. */
export function capturedWordAnchor(
  capture: WordDocumentCapture,
  first: number,
  last = first,
): WordReviewAnchor | null {
  const body = capturedBody(capture);
  if (first < 1 || last < first || last > body.length) return null;
  return {
    identity: capture.identity,
    span: wordParagraphAnchor(body, first - 1, last - 1),
  };
}

export function originalWordAnchor(
  edit: WordEdit,
  capture: WordDocumentCapture,
): WordReviewAnchor | null {
  const targets = planWordEdits([edit], capture).resolved[0]?.targets;
  return targets
    ? capturedWordAnchor(
        capture,
        targets[0].ordinal,
        targets[targets.length - 1].ordinal,
      )
    : null;
}

/** Explicit, so the identity text a selection capture records and its later proof compares cannot
 * drift with getText's defaults. */
export const WORD_SELECTION_TEXT_OPTIONS = {
  IncludeHiddenText: false,
  IncludeTextMarkedAsDeleted: false,
} as const;

/** Every body paragraph with the text the capture recorded: getText without hidden or deleted text. */
export async function readWordParagraphEntries(
  context: Word.RequestContext,
  textOptions?: Parameters<Word.Paragraph["getText"]>[0],
): Promise<{ items: Word.Paragraph[]; entries: WordParagraphEntry[] }> {
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load("items/uniqueLocalId");
  await context.sync();
  const texts = paragraphs.items.map((p) =>
    textOptions ? p.getText(textOptions) : p.getText(),
  );
  await context.sync();
  return {
    items: paragraphs.items,
    entries: paragraphs.items.map((p, i) => ({
      id: wordParagraphId(p.uniqueLocalId),
      text: texts[i].value,
    })),
  };
}

/**
 * Re-selecting the current selection raises no event (SV2:64-65), so a mark left for it would claim
 * the user's next selection; a failed compare only costs that precision.
 */
async function isCurrentSelection(
  context: Word.RequestContext,
  range: Word.Range,
): Promise<boolean> {
  try {
    const relation = context.document.getSelection().compareLocationWith(range);
    await context.sync();
    return relation.value === "Equal";
  } catch {
    return false;
  }
}

/** Word for the web rewrites the end paragraphs of a multi-paragraph range it selects (ERMAIN-932),
 * so only known desktop hosts select across paragraphs; elsewhere the first paragraph stands in. */
function selectsAcrossParagraphs(): boolean {
  const platform = wordHostPlatform();
  return platform === "PC" || platform === "Mac";
}

/** Marks the selection event a select() causes, unless it changes nothing or never runs. */
async function selectWordRange(
  context: Word.RequestContext,
  range: Word.Range,
): Promise<void> {
  if (await isCurrentSelection(context, range)) {
    range.select();
    await context.sync();
    return;
  }
  const mark = markProgrammaticWordSelection();
  range.select();
  try {
    await context.sync();
  } catch (error) {
    mark.cancel();
    throw error;
  }
  mark.selected();
}

export async function showWordReviewLocation(
  anchor: WordReviewAnchor,
  currentIdentity: string | null,
): Promise<WordLocationResult> {
  if (!currentIdentity || anchor.identity !== currentIdentity)
    return "identity-mismatch";
  const word = wordWriteHost();
  if (!word) return "unavailable";
  try {
    return await word.run(async (context) => {
      const { items, entries } = await readWordParagraphEntries(context);
      const resolved = resolveWordParagraphs(anchor.span, entries);
      if ("refused" in resolved) return "changed";
      const { positions } = resolved;
      const first = items[positions[0]].getRange("Content");
      const range =
        positions.length === 1 || !selectsAcrossParagraphs()
          ? first
          : first.expandTo(
              items[positions[positions.length - 1]].getRange("Content"),
            );
      await selectWordRange(context, range);
      const { paragraphs } = anchor.span;
      return paragraphs.length === 1 && paragraphs[0].text === ""
        ? "cleared"
        : "selected";
    });
  } catch {
    return "unavailable";
  }
}

/** Paragraph IDs of each body region an in-place write left, in document order. */
export function wordInPlaceWrittenRegions(
  record: WordInPlaceBackup,
): string[][] {
  return record.regions.flatMap((region) =>
    !region.story && region.after?.length ? [region.after] : [],
  );
}

/** The written region that holds the change to captured block `ref`. */
export function wordInPlaceRegionOf(
  record: WordInPlaceBackup,
  ref: string,
): string[] | undefined {
  return record.regions.find(
    (region) =>
      !region.story &&
      !!region.after?.length &&
      (region.before.some((i) => record.ops[i]?.ref === ref) ||
        record.ops.some(
          (op) =>
            op.kind === "insert" &&
            op.ref === ref &&
            !!op.id &&
            region.after!.includes(op.id),
        )),
  )?.after;
}

/** The body paragraph of each op whose written result did not verify. */
export function wordInPlaceMismatchedParagraphs(
  record: WordInPlaceBackup,
): string[] {
  return (record.mismatched ?? []).flatMap((i) => {
    const op = record.ops[i];
    return op?.id && op.kind !== "delete" && !(op.kind === "text" && op.story)
      ? [op.id]
      : [];
  });
}

/** Selects the paragraphs with these IDs; they must still be adjacent, in this order. Text is not
 * compared: the IDs come from this session's own write. */
export async function showWordParagraphs(
  ids: readonly string[],
  identity: string,
  currentIdentity: string | null,
  tracked = false,
): Promise<WordLocationResult> {
  if (!currentIdentity || identity !== currentIdentity)
    return "identity-mismatch";
  const word = wordWriteHost();
  if (!word || !ids.length) return "unavailable";
  if (
    tracked &&
    !globalThis.Office?.context?.requirements?.isSetSupported?.(
      "WordApi",
      "1.6",
    )
  )
    return "unavailable";
  try {
    return await word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items/uniqueLocalId");
      await context.sync();
      const index = new Map(
        paragraphs.items.map((p, i) => [p.uniqueLocalId, i] as const),
      );
      const positions = ids.map((id) => index.get(id) ?? -1);
      if (
        positions.some((p, i) => p < 0 || (i > 0 && p !== positions[i - 1] + 1))
      )
        return "changed";
      const items = positions.map((p) => paragraphs.items[p]);
      if (tracked) {
        const changes = items.map((p) => {
          const list = p.getTrackedChanges();
          list.load("items/type");
          return list;
        });
        await context.sync();
        const first = changes.find((list) => list.items.length)?.items[0];
        if (!first) return "changed";
        await selectWordRange(context, first.getRange());
      } else {
        const whole = items[0].getRange("Whole");
        await selectWordRange(
          context,
          items.length === 1 || !selectsAcrossParagraphs()
            ? whole
            : whole.expandTo(items[items.length - 1].getRange("Whole")),
        );
      }
      return "selected";
    });
  } catch {
    return "unavailable";
  }
}
