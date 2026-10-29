import { useCallback, useEffect, useRef, useState } from "react";

import { buildWordDocumentArgs } from "../utils/buildWordDocumentArgs";
import { readWordDocument } from "../utils/readWordDocument";
import { wordErrorText } from "../utils/wordApplyDiagnostics";
import {
  noteWordCapturedIds,
  recordWordUnknownChange,
  wordChangePosition,
} from "../utils/wordChangeJournal";
import {
  readWordChangeTrackingMode,
  subscribeWordDocumentChanged,
  wordParagraphEventsActive,
} from "../utils/wordDocumentChangeSignal";
import { captureWordAuthoringSnapshot } from "../utils/wordDocumentXml";
import { isWordTrackingMode } from "../utils/wordInPlaceSwitch";
import { withWordTimeout } from "../utils/wordTimeout";

import type {
  WordDocumentBuild,
  WordDocumentCoverage,
  WordParagraphRead,
} from "../utils/buildWordDocumentArgs";
import type { WordDocumentReadNote } from "../utils/readWordDocument";
import type { WordCaptureChanges } from "../utils/wordReadFreshness";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

export type WordDocumentStatus =
  | "unknown"
  | "unreadable"
  | "empty"
  | "included";

export interface WordDocumentPreview {
  authoringIssue?: WordAuthoringSnapshot["issue"];
  authoringDetails?: string[];
  trackChanges?: boolean;
  completeReadIssue?: WordAuthoringSnapshot["completeReadIssue"];
  authoringNote?: WordDocumentReadNote;
  status: WordDocumentStatus;
  coverage: WordDocumentCoverage | null;
  changedSinceLastSend: boolean;
  /** Why the last read failed, for the copyable error report. */
  readError?: string;
  /** A capture has been running long enough to be worth showing. */
  reading: boolean;
}

export interface WordDocumentSource {
  preview: WordDocumentPreview;
  /**
   * The last good capture of this document, for the chips' token estimate
   * only: never a copy for a send, and never to be changed.
   */
  lastBuild: WordDocumentBuild | null;
  /** A send-ready copy: reuses an unchanged capture, joins a running one, or starts one. */
  capture: () => Promise<WordDocumentBuild | null>;
  captureExpectedSlow: () => boolean;
  /** The last good capture even if the document changed since; apply re-checks it against Word. */
  previousCapture: () => WordDocumentBuild | null;
  /** Records what a send carried, for the "changed since last send" label. */
  markSent: (build: WordDocumentBuild | null) => void;
  /**
   * Reads the document again now, though a failed read otherwise waits for
   * the next send. `reading` turns true at once, so an unreadable document
   * shows loading, not a last flash of its error.
   */
  retry: () => void;
}

export const WORD_CAPTURE_SLOW_MS = 300;
/** Above every Office.js timeout in the read, so only a capture that hangs elsewhere hits it. */
export const WORD_CAPTURE_CEILING_MS = 90_000;
const LARGE_DOCUMENT_PARAGRAPHS = 1500;

interface CachedCapture {
  build: WordDocumentBuild | null;
  authoring: boolean;
  generation: number;
  durationMs: number;
  startedAt: number;
  /** A failed read or package transfer, or a capture Word was still tagging, is retried at the
   * next send; a file that can never be edited is not. */
  retry: boolean;
}

const RETRIED_AUTHORING_DETAILS = new Set([
  "package-timeout",
  "package-failed",
]);

interface CaptureFlight {
  promise: Promise<CachedCapture>;
  authoring: boolean;
  generation: number;
  startedAt: number;
}

const INITIAL_PREVIEW: WordDocumentPreview = {
  status: "unknown",
  coverage: null,
  changedSinceLastSend: false,
  reading: false,
};

/** Only for UI change detection; never use this hash to authorize a write. */
function hashDocument(text: string, total: number): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${total}:${(hash >>> 0).toString(16)}`;
}

/** The cached build is never handed out, so per-send state (token, reads, budget issue) starts clean. */
function copyForSend(
  build: WordDocumentBuild | null,
): WordDocumentBuild | null {
  if (!build) return null;
  const copy = globalThis.structuredClone(build);
  if (copy.authoring) copy.authoring.token = globalThis.crypto.randomUUID();
  return copy;
}

/** Native body blocks exclude table-cell paragraphs and can group anchored ranges, so only a text
 * that is unique on both sides maps a block to a paragraph collection ordinal. Word for Windows and
 * Mac end getText with the paragraph mark, which block texts never have. */
function assignParagraphOrdinals(
  authoring: WordAuthoringSnapshot,
  paragraphs: WordParagraphRead[],
): void {
  const ordinalsByText = new Map<string, number[]>();
  for (const paragraph of paragraphs) {
    const text = paragraph.text.replace(/\r$/, "");
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

async function captureDocument(
  documentIdentity: string,
  includeAuthoring: boolean,
): Promise<{
  build: WordDocumentBuild | null;
  error?: string;
  retry?: boolean;
}> {
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
      changes.proofingPending = true;
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

/** Reusing a capture is safe: every apply re-reads the document and refuses a stale plan. */
export function useWordDocumentSource({
  enabled,
  documentIdentity,
  authoringEnabled = false,
}: {
  enabled: boolean;
  documentIdentity: string;
  authoringEnabled?: boolean;
}): WordDocumentSource {
  const [preview, setPreview] = useState<WordDocumentPreview>(INITIAL_PREVIEW);
  const [lastBuild, setLastBuild] = useState<WordDocumentBuild | null>(null);
  const lastSentHashRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const cacheRef = useRef<CachedCapture | null>(null);
  const lastGoodRef = useRef<WordDocumentBuild | null>(null);
  const leftPaneRef = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const flightRef = useRef<CaptureFlight | null>(null);
  const identityRef = useRef(documentIdentity);
  const authoringRef = useRef(authoringEnabled);
  authoringRef.current = authoringEnabled;

  const isClean = useCallback((entry: CachedCapture | null) => {
    return (
      !!entry &&
      !entry.retry &&
      entry.generation === generationRef.current &&
      entry.authoring === authoringRef.current
    );
  }, []);

  const startCapture = useCallback((): Promise<CachedCapture> => {
    const flight = flightRef.current;
    if (flight && flight.authoring === authoringRef.current)
      return flight.promise;
    const identity = identityRef.current;
    const authoring = authoringRef.current;
    const generation = generationRef.current;
    const startedAt = globalThis.performance.now();
    const slowTimer = setTimeout(() => {
      if (flightRef.current?.startedAt === startedAt)
        setPreview((previous) =>
          previous.reading ? previous : { ...previous, reading: true },
        );
    }, WORD_CAPTURE_SLOW_MS);
    const promise = withWordTimeout(
      captureDocument(identity, authoring),
      WORD_CAPTURE_CEILING_MS,
      () => new Error(`capture timed out after ${WORD_CAPTURE_CEILING_MS} ms`),
    )
      .catch((error: unknown) => ({
        build: null,
        error: `capture: ${wordErrorText(error)}`,
        retry: undefined,
      }))
      .then(({ build, error, retry }) => {
        clearTimeout(slowTimer);
        const entry: CachedCapture = {
          build,
          authoring,
          generation,
          durationMs: globalThis.performance.now() - startedAt,
          startedAt,
          retry:
            !build ||
            !!retry ||
            !!build.authoring?.issueDetails?.some((detail) =>
              RETRIED_AUTHORING_DETAILS.has(detail),
            ),
        };
        if (flightRef.current?.startedAt === startedAt)
          flightRef.current = null;
        // A capture started earlier, e.g. before the facets changed, must not replace a newer one.
        if (
          identityRef.current !== identity ||
          (cacheRef.current && cacheRef.current.startedAt > startedAt)
        )
          return entry;
        cacheRef.current = entry;
        if (build) lastGoodRef.current = build;
        if (!build) {
          setPreview({
            ...INITIAL_PREVIEW,
            status: "unreadable",
            readError: error,
          });
          setLastBuild(null);
          return entry;
        }
        const hash = hashDocument(
          build.args.document_text,
          build.coverage.paragraphsTotal,
        );
        setPreview({
          authoringIssue: build.authoring?.issue,
          authoringDetails: build.authoring?.issueDetails,
          trackChanges: build.trackChanges,
          completeReadIssue: build.authoring?.completeReadIssue,
          authoringNote: build.readNote,
          status: build.coverage.hasContent ? "included" : "empty",
          coverage: build.coverage,
          changedSinceLastSend:
            lastSentHashRef.current !== null &&
            lastSentHashRef.current !== hash,
          reading: false,
        });
        setLastBuild(build);
        return entry;
      });
    flightRef.current = { promise, authoring, generation, startedAt };
    return promise;
  }, []);

  const prefetch = useCallback(() => {
    const entry = cacheRef.current;
    if (isClean(entry) || flightRef.current) return;
    // A failure the document did not cause is retried at the next send, not on every focus.
    if (
      entry?.retry &&
      entry.generation === generationRef.current &&
      entry.authoring === authoringRef.current
    )
      return;
    void startCapture();
  }, [isClean, startCapture]);

  useEffect(() => {
    if (identityRef.current === documentIdentity) return;
    identityRef.current = documentIdentity;
    cacheRef.current = null;
    lastGoodRef.current = null;
    flightRef.current = null;
    lastSentHashRef.current = null;
    setPreview(INITIAL_PREVIEW);
    setLastBuild(null);
  }, [documentIdentity]);

  useEffect(
    () =>
      subscribeWordDocumentChanged(() => {
        generationRef.current += 1;
      }),
    [],
  );

  // A Track Changes toggle fires no event, and without paragraph events neither does typing.
  // Formatting-only edits still go unnoticed; apply refuses the stale plan and marks a change.
  useEffect(() => {
    const leave = () => {
      leftPaneRef.current = true;
    };
    const refresh = () => {
      if (enabledRef.current) prefetch();
    };
    const back = () => {
      if (!leftPaneRef.current) {
        refresh();
        return;
      }
      leftPaneRef.current = false;
      if (!wordParagraphEventsActive()) {
        recordWordUnknownChange("return-to-pane");
        generationRef.current += 1;
        refresh();
        return;
      }
      const build = cacheRef.current?.build;
      const captured = build?.authoring?.trackingMode ?? build?.trackingMode;
      if (captured === undefined) {
        refresh();
        return;
      }
      void readWordChangeTrackingMode().then((mode) => {
        if (mode !== captured) {
          recordWordUnknownChange("tracking-mode");
          generationRef.current += 1;
        }
        refresh();
      });
    };
    globalThis.addEventListener("blur", leave);
    globalThis.addEventListener("focus", back);
    return () => {
      globalThis.removeEventListener("blur", leave);
      globalThis.removeEventListener("focus", back);
    };
  }, [prefetch]);

  useEffect(() => {
    if (enabled) prefetch();
  }, [enabled, prefetch, documentIdentity, authoringEnabled]);

  const capture = useCallback(async () => {
    let entry = cacheRef.current;
    if (!isClean(entry)) entry = await startCapture();
    // A capture that ran while the document changed is replaced once, not chased.
    if (entry && entry.generation !== generationRef.current)
      entry = await startCapture();
    return copyForSend(entry?.build ?? null);
  }, [isClean, startCapture]);

  const markSent = useCallback((build: WordDocumentBuild | null) => {
    lastSentHashRef.current = build
      ? hashDocument(build.args.document_text, build.coverage.paragraphsTotal)
      : null;
    setPreview((previous) =>
      previous.changedSinceLastSend
        ? { ...previous, changedSinceLastSend: false }
        : previous,
    );
  }, []);

  const captureExpectedSlow = useCallback(() => {
    if (isClean(cacheRef.current)) return false;
    const flight = flightRef.current;
    if (
      flight &&
      globalThis.performance.now() - flight.startedAt >= WORD_CAPTURE_SLOW_MS
    )
      return true;
    const last = cacheRef.current;
    return (
      !!last &&
      (last.durationMs >= WORD_CAPTURE_SLOW_MS ||
        (last.build?.coverage.paragraphsTotal ?? 0) >=
          LARGE_DOCUMENT_PARAGRAPHS)
    );
  }, [isClean]);

  const previousCapture = useCallback(
    () => copyForSend(lastGoodRef.current),
    [],
  );

  const retry = useCallback(() => {
    setPreview((previous) =>
      previous.reading ? previous : { ...previous, reading: true },
    );
    void startCapture();
  }, [startCapture]);

  return {
    preview,
    lastBuild,
    capture,
    captureExpectedSlow,
    previousCapture,
    markSent,
    retry,
  };
}
