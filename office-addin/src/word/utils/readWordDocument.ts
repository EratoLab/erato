import { wordErrorText } from "./wordApplyDiagnostics";
import {
  WordDocumentCaptureTimeoutError,
  WordDocumentTransferError,
  captureWordDocumentPackage,
  supportsWordDocumentPackage,
  wordDocumentImportedAt,
  wordPackagesDifferInDetectedLanguageOnly,
  wordProofingComplete,
} from "./wordDocumentPackage";
import { WordDocumentTooLargeError } from "./wordDocumentPackageCodec";
import { wordHostPlatform } from "./wordHostPlatform";
import { noteWordParagraphIds, wordParagraphId } from "./wordParagraphIds";
import { withWordTimeout } from "./wordTimeout";

import type { WordParagraphRead } from "./buildWordDocumentArgs";
import type { WordDocumentPackageSnapshot } from "./wordDocumentPackage";

export type WordDocumentReadResult =
  | {
      ok: true;
      paragraphs: WordParagraphRead[];
      authoring?: {
        ooxml: string;
        tracking: string;
        fullDocument?: boolean;
        documentUrl?: string;
        /** Word for Mac was still tagging languages when the capture stopped waiting for it. */
        proofingPending?: boolean;
      };
      /** The full package failed; the paragraphs still stand. */
      authoringUnavailable?: WordAuthoringUnavailable;
      /** Authoring works, but from less than the complete file. */
      note?: WordDocumentReadNote;
    }
  /** `error` names the failed step with our own or Office's generic message, never document text. */
  | { ok: false; error?: string };

/** Word for the web refused to open the file, as it does by design for a sensitivity-labelled
 * document (office-js #5297), so authoring falls back to the body. */
export type WordDocumentReadNote = "package-blocked";

/** getFileAsync's "Network Problem", which Word for the web returns by design for a document whose
 * sensitivity label withholds the file (office-js #5297). Other refusals, such as 11000 while both
 * of Office's file handles are held, can clear, so they leave text only and retry at the next send. */
const OFFICE_FILE_WITHHELD = 11001;

export interface WordAuthoringUnavailable {
  issue: "too-large" | "unavailable";
  /** Timeouts and failed transfers can succeed later; an unsupported file never will. */
  detail:
    | "package-too-large"
    | "package-timeout"
    | "package-failed"
    | "package-unsupported";
  error: string;
}

export const WORD_PARAGRAPH_READ_TIMEOUT_MS = 30_000;
/** Bounds the whole transfer however many slices Word returns, so a slow file keeps its text. */
export const WORD_PACKAGE_CAPTURE_TIMEOUT_MS = 45_000;

/** Word for Mac starts its proofing pass, which tags each paragraph with the language it detects,
 * 7–15 s after a document opens or is imported (ERMAIN-974). */
export const WORD_PROOFING_WINDOW_MS = 20_000;
/** The pass tags a few paragraphs at a time, about a second apart at most. */
const WORD_PROOFING_QUIET_MS = 3_000;
const WORD_PROOFING_POLL_MS = 1_000;
export const WORD_PROOFING_SETTLE_MS = 30_000;
/** From the start of the read, so waiting never takes a capture past the source's ceiling. */
export const WORD_PROOFING_DEADLINE_MS = 60_000;

const paneLoadedAt = Date.now();
/** Documents whose proofing pass never reported done while a capture waited, e.g. with spell
 * checking off; their captures no longer wait. */
const proofingQuiet = new Set<string>();

/**
 * A capture taken on Word for Mac before its proofing pass is done lacks the language tags Word
 * adds next, which Apply and Revert would refuse as a change. Reads again until Word reports the
 * pass done and captures that read, so no comparison has to set a language aside. A change other
 * than a w:lang in Word's detected form ends the wait with the read before it. Bounded, and only
 * paid while the pass is pending.
 */
async function settleWordProofing(
  first: WordDocumentPackageSnapshot,
  deadline: number,
): Promise<{ read: WordDocumentPackageSnapshot; pending?: boolean }> {
  if (
    wordHostPlatform() !== "Mac" ||
    proofingQuiet.has(first.documentUrl) ||
    wordProofingComplete(first.ooxml)
  )
    return { read: first };
  const started = Date.now();
  const stop = Math.min(started + WORD_PROOFING_SETTLE_MS, deadline);
  const windowEnd =
    Math.max(paneLoadedAt, wordDocumentImportedAt()) + WORD_PROOFING_WINDOW_MS;
  let current = first;
  let changedAt = started;
  for (;;) {
    const now = Date.now();
    const remaining = stop - now;
    if (
      remaining <= 0 ||
      (now >= windowEnd && now - changedAt >= WORD_PROOFING_QUIET_MS)
    )
      break;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(WORD_PROOFING_POLL_MS, remaining)),
    );
    let next: WordDocumentPackageSnapshot;
    try {
      next = await withWordTimeout(
        captureWordDocumentPackage(),
        Math.max(stop - Date.now(), WORD_PROOFING_POLL_MS),
        () => new WordDocumentCaptureTimeoutError(),
      );
    } catch {
      return { read: current, pending: true };
    }
    if (next.documentUrl !== first.documentUrl)
      throw new WordDocumentTransferError(
        "The open document changed during capture.",
      );
    if (
      next.ooxml !== current.ooxml &&
      next.fingerprint !== current.fingerprint
    ) {
      if (!wordPackagesDifferInDetectedLanguageOnly(current.ooxml, next.ooxml))
        return { read: current, pending: true };
      current = next;
      changedAt = Date.now();
    }
    if (wordProofingComplete(next.ooxml)) return { read: next };
  }
  if (current !== first || Date.now() < windowEnd)
    return { read: current, pending: true };
  proofingQuiet.add(first.documentUrl);
  return { read: current };
}

interface WordGlobal {
  run: <T>(
    callback: (context: Word.RequestContext) => Promise<T>,
  ) => Promise<T>;
}

const wordGlobal = (): WordGlobal | null => {
  const candidate = (globalThis as { Word?: Partial<WordGlobal> }).Word;
  return typeof candidate?.run === "function"
    ? (candidate as WordGlobal)
    : null;
};

/** Load IDs before queuing getText; its value is unreadable until the second sync.
 * Exclude hidden and deleted text. A Word.run with two syncs is not an atomic read. */
export async function readWordDocument(
  includeAuthoring = false,
): Promise<WordDocumentReadResult> {
  const word = wordGlobal();
  if (!word) return { ok: false };
  const started = Date.now();

  // The full package supersedes the body OOXML, which is then not fetched.
  const packaged = includeAuthoring && supportsWordDocumentPackage();
  let step = "paragraph read";
  try {
    const result = await withWordTimeout(
      word.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load(
          "items/uniqueLocalId,items/styleBuiltIn,items/outlineLevel",
        );
        await context.sync();

        const texts = paragraphs.items.map((paragraph) => paragraph.getText());
        const native =
          includeAuthoring && !packaged
            ? context.document.body.getOoxml()
            : null;
        if (includeAuthoring) context.document.load("changeTrackingMode");
        await context.sync();

        const ids = paragraphs.items.map((paragraph) =>
          wordParagraphId(paragraph.uniqueLocalId),
        );
        noteWordParagraphIds(ids);
        return {
          ok: true as const,
          ...(includeAuthoring
            ? {
                authoring: {
                  ooxml: native?.value ?? "",
                  tracking: String(context.document.changeTrackingMode),
                },
              }
            : {}),
          paragraphs: paragraphs.items.map((paragraph, index) => ({
            ordinal: index + 1,
            text: texts[index]?.value ?? "",
            uniqueLocalId: ids[index],
            styleBuiltIn: String(paragraph.styleBuiltIn ?? ""),
            outlineLevel: paragraph.outlineLevel,
          })),
        };
      }),
      WORD_PARAGRAPH_READ_TIMEOUT_MS,
      () => new Error(`timed out after ${WORD_PARAGRAPH_READ_TIMEOUT_MS} ms`),
    );
    if (packaged && result.authoring) {
      step = "full-document capture";
      // A failed full capture must not degrade into a partial rewrite or clear, so authoring is
      // dropped and only the paragraph text remains. Only a file Word for the web withholds falls
      // back to the body route, whose capture says it is not the whole document; any other failed
      // transfer, or a document that changes during capture, is retried at the next send.
      try {
        const { read: full, pending } = await settleWordProofing(
          await withWordTimeout(
            captureWordDocumentPackage(),
            WORD_PACKAGE_CAPTURE_TIMEOUT_MS,
            () => new WordDocumentCaptureTimeoutError(),
          ),
          started + WORD_PROOFING_DEADLINE_MS,
        );
        return {
          ...result,
          authoring: {
            ...result.authoring,
            ooxml: full.ooxml,
            fullDocument: true,
            documentUrl: full.documentUrl,
            ...(pending ? { proofingPending: true } : {}),
          },
        };
      } catch (error) {
        const body =
          error instanceof WordDocumentTransferError &&
          error.refused &&
          error.officeCode === OFFICE_FILE_WITHHELD &&
          wordHostPlatform() === "OfficeOnline"
            ? await readWordBody(word)
            : undefined;
        if (body)
          return {
            ...result,
            authoring: { ...body, fullDocument: false },
            note: "package-blocked",
          };
        return {
          ok: true,
          paragraphs: result.paragraphs,
          authoringUnavailable: authoringUnavailable(error, step),
        };
      }
    }
    return result;
  } catch (error) {
    return { ok: false, error: `${step}: ${wordErrorText(error)}` };
  }
}

/** The body route's authoring read, in a run of its own; undefined when Word fails it too. */
async function readWordBody(
  word: WordGlobal,
): Promise<{ ooxml: string; tracking: string } | undefined> {
  try {
    return await withWordTimeout(
      word.run(async (context) => {
        const body = context.document.body.getOoxml();
        context.document.load("changeTrackingMode");
        await context.sync();
        return {
          ooxml: body.value,
          tracking: String(context.document.changeTrackingMode),
        };
      }),
      WORD_PARAGRAPH_READ_TIMEOUT_MS,
      () => new Error(`timed out after ${WORD_PARAGRAPH_READ_TIMEOUT_MS} ms`),
    );
  } catch {
    return undefined;
  }
}

function authoringUnavailable(
  error: unknown,
  step: string,
): WordAuthoringUnavailable {
  const text = `${step}: ${wordErrorText(error)}`;
  if (error instanceof WordDocumentTooLargeError)
    return { issue: "too-large", detail: "package-too-large", error: text };
  if (error instanceof WordDocumentCaptureTimeoutError)
    return { issue: "unavailable", detail: "package-timeout", error: text };
  if (error instanceof WordDocumentTransferError)
    return { issue: "unavailable", detail: "package-failed", error: text };
  return { issue: "unavailable", detail: "package-unsupported", error: text };
}
