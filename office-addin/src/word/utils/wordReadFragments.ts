import type { WordReadableSourceBlock } from "./wordAuthoringReadData";
import type { WordPlanRun } from "@erato/frontend/word-review";

/** The page size of every paged read, in UTF-8 bytes of the page's JSON. */
export const WORD_READ_PAGE_BYTES = 20 * 1024;
const TEXT_PIECE_CHARS = 4096;
const STRUCTURE_PART_CHARS = 2048;

export interface WordReadFragment {
  ref: string;
  type: string;
  level?: number;
  styleRef?: string;
  list?: string;
  ordered?: boolean;
  protected: boolean;
  part: number;
  parts: number;
  text: string;
  runs?: WordPlanRun[];
  nativeKind?: string;
  description?: string;
  sectionBoundary?: boolean;
  structureJson?: string;
  structurePart?: number;
  structureParts?: number;
}

export type WordReadRecord = (
  | Omit<WordReadableSourceBlock, "content" | "objects" | "format">
  | {
      ref: string;
      type: "story" | "sections";
      protected: boolean;
      text: string;
      runs?: undefined;
    }
) & { structure: Record<string, unknown> };

/** A block as the complete read pages it: its text, with the rest as a structure object. */
export function wordReadRecord(block: WordReadableSourceBlock): WordReadRecord {
  const { content, objects, format, ...rest } = block;
  return {
    ...rest,
    structure: {
      ...(content ? { content } : {}),
      ...(objects ? { objects } : {}),
      ...(format ? { format } : {}),
    },
  };
}

export const wordReadJsonBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

export function wordReadFragments({
  text,
  runs,
  structure,
  ...block
}: WordReadRecord): WordReadFragment[] {
  const chars = Array.from(text);
  const fragments: WordReadFragment[] = [];
  let offset = 0,
    codeUnitOffset = 0;
  do {
    let end = Math.min(chars.length, offset + TEXT_PIECE_CHARS);
    let fragment: WordReadFragment;
    while (true) {
      const piece = chars.slice(offset, end).join("");
      let position = 0;
      const pieceRuns = runs?.flatMap((r) => {
        const start = Math.max(0, codeUnitOffset - position);
        const until = Math.min(
          r.text.length,
          codeUnitOffset + piece.length - position,
        );
        position += r.text.length;
        return until > start
          ? [{ ...r, text: r.text.slice(start, until) }]
          : [];
      });
      fragment = {
        ...block,
        text: piece,
        ...(pieceRuns ? { runs: pieceRuns } : {}),
        part: fragments.length + 1,
        parts: 0,
      };
      if (
        wordReadJsonBytes(fragment) <= WORD_READ_PAGE_BYTES ||
        end <= offset + 1
      )
        break;
      end = offset + Math.max(1, Math.floor((end - offset) / 2));
    }
    fragments.push(fragment);
    codeUnitOffset += fragment.text.length;
    offset = end;
  } while (offset < chars.length);
  if (Object.keys(structure).length) {
    const data = Array.from(JSON.stringify(structure));
    const count = Math.ceil(data.length / STRUCTURE_PART_CHARS);
    for (let part = 0; part < count; part++)
      fragments.push({
        ref: block.ref,
        type: block.type,
        protected: false,
        text: "",
        part: fragments.length + 1,
        parts: 0,
        structureJson: data
          .slice(part * STRUCTURE_PART_CHARS, (part + 1) * STRUCTURE_PART_CHARS)
          .join(""),
        structurePart: part + 1,
        structureParts: count,
      });
  }
  for (const fragment of fragments) fragment.parts = fragments.length;
  return fragments;
}

/** The index of each page's first item, packing items of these JSON sizes greedily into pages. */
export function wordReadPageStarts(bytes: readonly number[]): number[] {
  const starts: number[] = [];
  let size = 0;
  bytes.forEach((itemBytes, k) => {
    if (!starts.length || size + 1 + itemBytes > WORD_READ_PAGE_BYTES) {
      starts.push(k);
      size = 2 + itemBytes;
    } else size += 1 + itemBytes;
  });
  return starts;
}
