import { planWordEdits } from "./wordEditPlan";
import { wordWriteHost } from "./wordWriteHost";

import type { WordDocumentCapture } from "./wordDocumentCapture";
import type { WordEdit } from "./wordEditPlan";

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

/** Read only. Tracking is owned by Word and is never changed by the add-in. */
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

/** Ordered, contiguous, exact verification, shared by navigation and result capture. */
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

/** Explicit navigation only: no text search, ordinal fallback, or document markers. */
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
