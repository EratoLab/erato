import type { WordSourceBlock } from "./wordDocumentPlan";

export type WordReadableSourceBlock = Omit<
  WordSourceBlock,
  "xml" | "paragraphOrdinal"
>;

/** A paragraph-wide run duplicates its text; send its font formatting once.
 * Mixed runs retain their boundaries, including explicit false marks. */
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
