import { planWordEdits } from "@erato/frontend/word-review";

import { wordWriteHost } from "./wordWriteHost";

import type { WordInPlaceBackup } from "./wordDocumentPackage";
import type {
  WordDocumentCapture,
  WordEdit,
} from "@erato/frontend/word-review";

export type WordTrackingMode = "off" | "on" | "unknown";
export interface WordReviewAnchor {
  identity: string;
  paragraphs: { uniqueLocalId: string; text: string }[];
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

export function originalWordAnchor(
  edit: WordEdit,
  capture: WordDocumentCapture,
): WordReviewAnchor | null {
  const resolved = planWordEdits([edit], capture).resolved[0];
  return resolved
    ? {
        identity: capture.identity,
        paragraphs: resolved.targets.map((target) => ({
          uniqueLocalId: target.uniqueLocalId,
          text: target.sentText,
        })),
      }
    : null;
}

export function verifiedAnchorPositions(
  anchor: WordReviewAnchor,
  current: readonly { uniqueLocalId: string; text: string }[],
): number[] | null {
  if (anchor.paragraphs.length === 0) return null;
  const byId = new Map(
    current.map((p, index) => [p.uniqueLocalId, { ...p, index }]),
  );
  const positions: number[] = [];
  for (const expected of anchor.paragraphs) {
    const actual = byId.get(expected.uniqueLocalId);
    if (
      !actual ||
      actual.text !== expected.text ||
      (positions.length > 0 &&
        actual.index !== positions[positions.length - 1] + 1)
    )
      return null;
    positions.push(actual.index);
  }
  return positions;
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
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items/uniqueLocalId");
      await context.sync();
      const wanted = new Set(anchor.paragraphs.map((p) => p.uniqueLocalId));
      const text = new Map(
        paragraphs.items
          .filter((p) => wanted.has(p.uniqueLocalId))
          .map((p) => [p.uniqueLocalId, p.getText()]),
      );
      await context.sync();
      const positions = verifiedAnchorPositions(
        anchor,
        paragraphs.items.map((p) => ({
          uniqueLocalId: p.uniqueLocalId,
          text: text.get(p.uniqueLocalId)?.value ?? "",
        })),
      );
      if (!positions) return "changed";
      const first = paragraphs.items[positions[0]].getRange("Content");
      const range =
        positions.length === 1
          ? first
          : first.expandTo(
              paragraphs.items[positions[positions.length - 1]].getRange(
                "Content",
              ),
            );
      range.select();
      await context.sync();
      return anchor.paragraphs.length === 1 && anchor.paragraphs[0].text === ""
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
        first.getRange().select();
      } else
        items[0]
          .getRange("Whole")
          .expandTo(items[items.length - 1].getRange("Whole"))
          .select();
      await context.sync();
      return "selected";
    });
  } catch {
    return "unavailable";
  }
}
