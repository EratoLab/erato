import {
  captureWordDocumentPackage,
  supportsWordDocumentPackage,
} from "./wordDocumentPackage";

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
    }
  | { ok: false };

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

  try {
    const result = await word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load(
        "items/uniqueLocalId,items/styleBuiltIn,items/outlineLevel",
      );
      await context.sync();

      const texts = paragraphs.items.map((paragraph) => paragraph.getText());
      const native = includeAuthoring ? context.document.body.getOoxml() : null;
      if (includeAuthoring) context.document.load("changeTrackingMode");
      await context.sync();

      return {
        ok: true as const,
        ...(native
          ? {
              authoring: {
                ooxml: native.value,
                tracking: String(context.document.changeTrackingMode),
              },
            }
          : {}),
        paragraphs: paragraphs.items.map((paragraph, index) => ({
          ordinal: index + 1,
          text: texts[index]?.value ?? "",
          uniqueLocalId: paragraph.uniqueLocalId,
          styleBuiltIn: String(paragraph.styleBuiltIn ?? ""),
          outlineLevel: paragraph.outlineLevel,
        })),
      };
    });
    if (includeAuthoring && result.authoring && supportsWordDocumentPackage()) {
      // A failed full capture must not degrade into a partial rewrite or clear.
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
    }
    return result;
  } catch {
    return { ok: false };
  }
}
