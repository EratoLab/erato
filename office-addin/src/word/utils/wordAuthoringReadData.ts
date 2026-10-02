import type {
  WordAuthoringSnapshot,
  WordSourceBlock,
} from "@erato/frontend/word-review";

/** The style catalogue a read returns: every style by name, and for the styles the body uses, the
 * look a block keeps when its plan sets no format. */
export function wordReadableStyles(
  styles: WordAuthoringSnapshot["styles"],
): Omit<WordAuthoringSnapshot["styles"][number], "inUse">[] {
  return styles.map(({ look, inUse, ...style }) =>
    inUse && look ? { ...style, look } : style,
  );
}

/** What the catalogue costs without looks; reads refuse documents whose names alone exceed it. */
export function wordStyleNamesBytes(
  styles: WordAuthoringSnapshot["styles"],
): number {
  return new TextEncoder().encode(
    JSON.stringify(styles.map(({ look: _look, inUse: _inUse, ...s }) => s)),
  ).length;
}

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
