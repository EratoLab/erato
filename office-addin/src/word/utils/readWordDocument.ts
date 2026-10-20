import { wordErrorText } from "./wordApplyDiagnostics";
import {
  WordDocumentCaptureTimeoutError,
  WordDocumentTransferError,
  captureWordDocumentPackage,
  currentWordDocumentUrl,
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
      /** Word's changeTrackingMode at the paragraph read, whatever becomes of the package. */
      tracking: string;
      authoring?: {
        ooxml: string;
        tracking: string;
        fullDocument?: boolean;
        documentUrl?: string;
        /** Word had not reported its proofing pass done when the capture stopped waiting. */
        proofingPending?: WordProofingPending;
      };
      /** The full package failed; the paragraphs still stand. */
      authoringUnavailable?: WordAuthoringUnavailable;
      /** Authoring works, but from less than the complete file. */
      note?: WordDocumentReadNote;
    }
  /** `error` names the failed step with our own or Office's generic message, never document text. */
  | { ok: false; error?: string };

/** "tagging": Word was still tagging languages at the wait's bound; "changed": a change other than
 * Word's tagging ended the wait. Either way the next send captures again. */
export type WordProofingPending = "tagging" | "changed";

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

/** How long after the pane loads, or after an import, Word's proofing pass (which tags each
 * paragraph with the language it detects) may still start. Word for Mac: 7–15 s after a document
 * opens or is imported (ERMAIN-974). Word PC: for the first document after Word starts, up to
 * 19.5 s after the pane loaded (ERMAIN-981); later documents are tagged before the pane loads. */
export const WORD_PROOFING_WINDOW_MS = { Mac: 20_000, PC: 22_000 } as const;
/** The pass tags a few paragraphs at a time, about a second apart at most. */
const WORD_PROOFING_QUIET_MS = 3_000;
const WORD_PROOFING_POLL_MS = 1_000;
/** From the start of the read. A send gives up on its capture after 30 s
 * (WORD_SEND_CAPTURE_DEADLINE_MS) and takes an older one with fewer of Word's tags, so the wait
 * ends early enough to build the snapshot within that. */
export const WORD_PROOFING_DEADLINE_MS = 25_000;

const paneLoadedAt = Date.now();
/** When a wait saw a document's pass stay silent through the window, e.g. with spell checking off.
 * Its captures no longer wait, until an import starts a new pass. */
const proofingQuiet = new Map<string, number>();

/**
 * A capture taken on Word for Mac or Word PC before its proofing pass is done lacks the language
 * tags Word adds next, which Apply and Revert would refuse as a change. Reads again until Word
 * reports the pass done and captures that read, so no comparison has to set a language aside. A
 * change other than a w:lang in Word's detected form ends the wait with the read before it.
 * Bounded, and only paid while the pass is pending.
 */
async function settleWordProofing(
  first: WordDocumentPackageSnapshot,
  deadline: number,
  transferMs: number,
): Promise<{
  read: WordDocumentPackageSnapshot;
  pending?: WordProofingPending;
}> {
  const platform = wordHostPlatform();
  const quietAt = proofingQuiet.get(first.documentUrl);
  if (
    (platform !== "Mac" && platform !== "PC") ||
    (quietAt !== undefined && quietAt > wordDocumentImportedAt()) ||
    wordProofingComplete(first.ooxml)
  )
    return { read: first };
  const windowEnd =
    Math.max(paneLoadedAt, wordDocumentImportedAt()) +
    WORD_PROOFING_WINDOW_MS[platform];
  let current = first;
  let changedAt = Date.now();
  let transfer = transferMs;
  for (;;) {
    const now = Date.now();
    if (now >= windowEnd && now - changedAt >= WORD_PROOFING_QUIET_MS) {
      if (current !== first) return { read: current, pending: "tagging" };
      proofingQuiet.set(first.documentUrl, now);
      return { read: current };
    }
    // A poll still running at the deadline would keep one of Office's two file handles after the
    // capture returned.
    if (now + WORD_PROOFING_POLL_MS + transfer > deadline)
      return { read: current, pending: "tagging" };
    await new Promise((resolve) => setTimeout(resolve, WORD_PROOFING_POLL_MS));
    const polled = Date.now();
    let next: WordDocumentPackageSnapshot;
    try {
      next = await withWordTimeout(
        captureWordDocumentPackage(),
        Math.max(deadline - polled, WORD_PROOFING_POLL_MS),
        () => new WordDocumentCaptureTimeoutError(),
      );
    } catch {
      if (currentWordDocumentUrl() !== first.documentUrl)
        throw new WordDocumentTransferError(
          "The open document changed during capture.",
        );
      return { read: current, pending: "tagging" };
    }
    transfer = Date.now() - polled;
    if (next.documentUrl !== first.documentUrl)
      throw new WordDocumentTransferError(
        "The open document changed during capture.",
      );
    if (
      next.ooxml !== current.ooxml &&
      next.fingerprint !== current.fingerprint
    ) {
      if (!wordPackagesDifferInDetectedLanguageOnly(current, next))
        return { read: current, pending: "changed" };
      current = next;
      changedAt = Date.now();
    }
    if (wordProofingComplete(next.ooxml)) return { read: next };
  }
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
        context.document.load("changeTrackingMode");
        await context.sync();

        const ids = paragraphs.items.map((paragraph) =>
          wordParagraphId(paragraph.uniqueLocalId),
        );
        noteWordParagraphIds(ids);
        return {
          ok: true as const,
          tracking: String(context.document.changeTrackingMode),
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
        const transferStarted = Date.now();
        const firstRead = await withWordTimeout(
          captureWordDocumentPackage(),
          WORD_PACKAGE_CAPTURE_TIMEOUT_MS,
          () => new WordDocumentCaptureTimeoutError(),
        );
        const { read: full, pending } = await settleWordProofing(
          firstRead,
          started + WORD_PROOFING_DEADLINE_MS,
          Date.now() - transferStarted,
        );
        return {
          ...result,
          authoring: {
            ...result.authoring,
            ooxml: full.ooxml,
            fullDocument: true,
            documentUrl: full.documentUrl,
            ...(pending ? { proofingPending: pending } : {}),
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
          tracking: result.tracking,
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
