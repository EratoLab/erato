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
  "xml" | "paragraphOrdinal" | "outlineLevel"
>;

type WordSourceRun = NonNullable<WordSourceBlock["runs"]>[number];

const sameRunFormat = (a: WordSourceRun, b: WordSourceRun) => {
  const { text: _a, ...left } = a;
  const { text: _b, ...right } = b;
  const keys = Object.keys(left) as (keyof typeof left)[];
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key])
  );
};

/** Word splits a uniformly formatted span at proofing marks and revision IDs, which the capture
 * drops, so identical neighbours read as one run whatever Word's last proofing pass did. */
function joinedRuns(runs: readonly WordSourceRun[]): WordSourceRun[] {
  const joined: WordSourceRun[] = [];
  for (const run of runs) {
    const previous = joined.at(-1);
    if (previous && sameRunFormat(previous, run))
      joined[joined.length - 1] = {
        ...previous,
        text: previous.text + run.text,
      };
    else joined.push(run);
  }
  return joined;
}

/** A paragraph-wide run duplicates its text; send its font formatting once.
 * Mixed runs retain their boundaries, including explicit false marks. */
export function wordReadableSourceBlock(
  source: WordSourceBlock,
): WordReadableSourceBlock {
  const {
    xml: _xml,
    paragraphOrdinal: _ordinal,
    outlineLevel: _outlineLevel,
    runs: capturedRuns,
    ...block
  } = source;
  const runs = capturedRuns && joinedRuns(capturedRuns);
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
