import {
  buildWordDocumentArgs,
  withoutParagraphMark,
} from "./buildWordDocumentArgs";
import { readWordDocument } from "./readWordDocument";
import {
  noteWordCapturedIds,
  wordChangePosition,
  wordChangesSince,
} from "./wordChangeJournal";
import { wordParagraphEventsPending } from "./wordDocumentChangeSignal";
import { captureWordAuthoringSnapshot } from "./wordDocumentXml";
import { isWordTrackingMode } from "./wordInPlaceSwitch";
import { withWordTimeout } from "./wordTimeout";

import type {
  WordDocumentBuild,
  WordParagraphRead,
} from "./buildWordDocumentArgs";
import type { WordChangePosition } from "./wordChangeJournal";
import type { WordCaptureChanges, WordReadCapture } from "./wordReadFreshness";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

/** Registering the paragraph events took up to 2.4 s on a cold Word for Mac (ERMAIN-1005 F1). */
const EVENTS_READY_WAIT_MS = 3_000;

/** Native body blocks exclude table-cell paragraphs and can group anchored ranges, so only a text
 * that is unique on both sides maps a block to a paragraph collection ordinal. */
function assignParagraphOrdinals(
  authoring: WordAuthoringSnapshot,
  paragraphs: WordParagraphRead[],
): void {
  const ordinalsByText = new Map<string, number[]>();
  for (const paragraph of paragraphs) {
    const text = withoutParagraphMark(paragraph.text);
    const ordinals = ordinalsByText.get(text);
    if (ordinals) ordinals.push(paragraph.ordinal);
    else ordinalsByText.set(text, [paragraph.ordinal]);
  }
  const blocksByText = new Map<string, number>();
  for (const block of authoring.blocks)
    blocksByText.set(block.text, (blocksByText.get(block.text) ?? 0) + 1);
  for (const block of authoring.blocks) {
    if (block.type === "native") continue;
    const matches = ordinalsByText.get(block.text);
    if (matches?.length === 1 && blocksByText.get(block.text) === 1)
      block.paragraphOrdinal = matches[0];
  }
}

export async function captureWordDocument(
  documentIdentity: string,
  includeAuthoring: boolean,
): Promise<{
  build: WordDocumentBuild | null;
  error?: string;
  retry?: boolean;
}> {
  const registering = wordParagraphEventsPending();
  if (registering)
    await withWordTimeout(
      registering,
      EVENTS_READY_WAIT_MS,
      () => new Error("paragraph events not registered"),
    ).catch(() => {});
  const changes: WordCaptureChanges = {
    position: wordChangePosition(),
    capturedAt: new Date().toISOString(),
  };
  const result = await readWordDocument(includeAuthoring);
  if (!result.ok) return { build: null, error: result.error };
  noteWordCapturedIds(result.paragraphs.map((p) => p.uniqueLocalId));
  const build = buildWordDocumentArgs(result.paragraphs);
  build.changes = changes;
  if (result.tracking !== undefined) build.trackingMode = result.tracking;
  if (isWordTrackingMode(result.tracking)) build.trackChanges = true;
  if (result.authoring) {
    build.authoring = captureWordAuthoringSnapshot(
      result.authoring.ooxml,
      documentIdentity,
      result.authoring.tracking,
      result.authoring.fullDocument,
    );
    build.authoring.documentUrl = result.authoring.documentUrl;
    assignParagraphOrdinals(build.authoring, result.paragraphs);
    if (result.note) build.readNote = result.note;
    if (result.authoring.proofingPending) {
      if (result.authoring.proofingPending === "tagging")
        build.authoring.proofingPending = true;
      // Word adds its tags without a change event, so only a send can pick them up.
      return { build, retry: true };
    }
  } else if (result.authoringUnavailable) {
    build.authoring = {
      ...captureWordAuthoringSnapshot("", documentIdentity, ""),
      issue: result.authoringUnavailable.issue,
      issueDetails: [result.authoringUnavailable.detail],
    };
  }
  return { build };
}

/** The body an apply wrote and verified, kept so the next read need not read the body again. */
export interface WordVerifiedBody {
  ooxml: string;
  tracking: string;
  /** Where the change journal stood right after the verify read. */
  position: WordChangePosition;
}

export interface WordRequestCapture {
  snapshot: WordAuthoringSnapshot;
  capture: WordReadCapture;
  /** The verified body stood in for the body read. */
  reusedVerifiedBody: boolean;
}

/** Only the pane's own writes since the verify read: the verified body is still the document. */
function unchangedSince(position: WordChangePosition): boolean {
  const since = wordChangesSince(position);
  return since.ok && since.entries.every((entry) => entry.source === "own");
}

/**
 * The capture a read in the middle of an answer takes, as Send takes it, of the document as it is
 * now. A verified body with no change since stands in for the body read; the paragraphs are still
 * read for their ids, which the freshness of later reads needs.
 */
export async function captureWordDocumentForRequest(
  identity: string,
  verified?: WordVerifiedBody,
): Promise<WordRequestCapture | null> {
  if (verified && unchangedSince(verified.position)) {
    const changes: WordCaptureChanges = {
      position: wordChangePosition(),
      capturedAt: new Date().toISOString(),
    };
    const read = await readWordDocument(false);
    if (read.ok && unchangedSince(verified.position)) {
      noteWordCapturedIds(read.paragraphs.map((p) => p.uniqueLocalId));
      const build = buildWordDocumentArgs(read.paragraphs);
      const snapshot = captureWordAuthoringSnapshot(
        verified.ooxml,
        identity,
        verified.tracking,
        false,
      );
      assignParagraphOrdinals(snapshot, read.paragraphs);
      return {
        snapshot,
        capture: { changes, ordinalMap: build.ordinalMap },
        reusedVerifiedBody: true,
      };
    }
  }
  const { build } = await captureWordDocument(identity, true);
  if (!build?.authoring) return null;
  return {
    snapshot: build.authoring,
    capture: { changes: build.changes, ordinalMap: build.ordinalMap },
    reusedVerifiedBody: false,
  };
}
