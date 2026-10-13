import { wordErrorText } from "./wordApplyDiagnostics";
import {
  WordDocumentCaptureTimeoutError,
  WordDocumentTransferError,
  captureWordDocumentPackage,
  supportsWordDocumentPackage,
} from "./wordDocumentPackage";
import { WordDocumentTooLargeError } from "./wordDocumentPackageCodec";
import { wordHostPlatform } from "./wordHostPlatform";
import { noteWordParagraphIds, wordParagraphId } from "./wordParagraphIds";
import { withWordTimeout } from "./wordTimeout";

import type { WordParagraphRead } from "./buildWordDocumentArgs";

export type WordDocumentReadResult =
  | {
      ok: true;
      paragraphs: WordParagraphRead[];
      authoring?: {
        ooxml: string;
        tracking: string;
        fullDocument?: boolean;
        documentUrl?: string;
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
        const full = await withWordTimeout(
          captureWordDocumentPackage(),
          WORD_PACKAGE_CAPTURE_TIMEOUT_MS,
          () => new WordDocumentCaptureTimeoutError(),
        );
        return {
          ...result,
          authoring: {
            ...result.authoring,
            ooxml: full.ooxml,
            fullDocument: true,
            documentUrl: full.documentUrl,
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
