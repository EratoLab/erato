import type { WordSourceBlock } from "./wordDocumentPlan";

/** Model-facing source data. Host navigation and XML never enter a read result. */
export type WordReadableSourceBlock = Omit<
  WordSourceBlock,
  "xml" | "paragraphOrdinal"
>;

/** A single run covering the complete paragraph describes paragraph-wide font
 * formatting. Send that formatting once, without duplicating all its text.
 * Mixed runs keep their exact text boundaries, including explicit false marks.
 *
 * Capture size checks, tool pagination and model-budget estimation share this
 * projection. The native snapshot itself is untouched for review and recovery.
 */
export function wordReadableSourceBlock(
  source: WordSourceBlock,
): WordReadableSourceBlock {
  const { xml: _xml, paragraphOrdinal: _ordinal, runs, ...block } = source;
  if (
    runs?.length === 1 &&
    runs[0].text === source.text &&
    ["paragraph", "heading", "list-item"].includes(source.type)
  ) {
    const { text: _text, ...font } = runs[0];
    return {
      ...block,
      ...(Object.keys(font).length
        ? {
            format: {
              ...block.format,
              font: { ...block.format?.font, ...font },
            },
          }
        : {}),
    };
  }
  return { ...block, ...(runs !== undefined ? { runs } : {}) };
}
