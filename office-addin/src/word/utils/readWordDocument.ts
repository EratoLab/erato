import { wordErrorText } from "./wordApplyDiagnostics";
import {
  WordDocumentCaptureTimeoutError,
  captureWordDocumentPackage,
  supportsWordDocumentPackage,
} from "./wordDocumentPackage";
import { WordDocumentTooLargeError } from "./wordDocumentPackageCodec";
import { noteWordParagraphIds, wordParagraphId } from "./wordParagraphIds";

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
    }
  /** `error` names the failed step with our own or Office's generic message, never document text. */
  | { ok: false; error?: string };

export interface WordAuthoringUnavailable {
  issue: "too-large" | "unavailable";
  detail: "package-too-large" | "package-timeout" | "package-failed";
  error: string;
}

export const WORD_PARAGRAPH_READ_TIMEOUT_MS = 30_000;

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
    const result = await withTimeout(
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
    );
    if (packaged && result.authoring) {
      step = "full-document capture";
      // A failed full capture must not degrade into a partial rewrite or clear, so authoring is
      // dropped and only the paragraph text remains.
      try {
        const full = await captureWordDocumentPackage();
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

function authoringUnavailable(
  error: unknown,
  step: string,
): WordAuthoringUnavailable {
  const text = `${step}: ${wordErrorText(error)}`;
  if (error instanceof WordDocumentTooLargeError)
    return { issue: "too-large", detail: "package-too-large", error: text };
  if (error instanceof WordDocumentCaptureTimeoutError)
    return { issue: "unavailable", detail: "package-timeout", error: text };
  return { issue: "unavailable", detail: "package-failed", error: text };
}

/** Word.run cannot be cancelled; the timeout only stops the capture from waiting on it. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${ms} ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
