import { wordBlockIndex, wordCaptureSections } from "./wordDocumentOutline";
import {
  wordListedNames,
  wordPassageStart,
  wordPlanWrittenBlocks,
  wordTitledPart,
} from "./wordPlanDocumentChanges";

import type { WordCaptureSections } from "./wordDocumentOutline";
import type {
  WordAuthoringSnapshot,
  WordPlanEntry,
} from "@erato/frontend/word-review";

/** Bounds what a receipt stores; the card names the first few. */
const MAX_LISTED = 20;
const MAX_NOTE_NAMES = 3;
/** A replay receipt keeps a field only up to 512 bytes of JSON (MAX_RECEIPT_FIELD_BYTES). */
const MAX_NOTE_BYTES = 480;

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const items = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): string[] =>
  items(v).filter((r): r is string => typeof r === "string");

/**
 * The body blocks a submission changes, read leniently from its arguments so that an attempt
 * refused before parsing (for its size, say) still counts. A sparse change is read as sent, never
 * as the plan it expands to, so a refused and an accepted sparse change name blocks alike: moves
 * count their sources, insertions their anchor.
 */
export function wordSubmissionBlocks(
  input: unknown,
  snapshot: WordAuthoringSnapshot,
): Set<number> {
  const index = wordBlockIndex(snapshot);
  const blocks = new Set<number>();
  const add = (ref: unknown) => {
    if (typeof ref !== "string") return;
    // After a complete read an object ref is its block's ref, "__" and the object's target.
    const at = index.get(ref) ?? index.get(ref.split("__")[0]);
    if (at !== undefined) blocks.add(at);
  };
  if (!object(input)) return blocks;
  const edit = input.scoped_edit;
  if (object(edit)) {
    for (const change of items(edit.body)) {
      if (!object(change)) continue;
      strings(change.source).forEach(add);
      if (String(change.operation).startsWith("insert-")) add(change.anchor);
    }
    for (const change of items(edit.objects))
      if (object(change)) add(change.ref);
    for (const story of items(edit.stories))
      if (object(story) && object(story.anchor)) add(story.anchor.block);
    return blocks;
  }
  if (object(input.table_cell)) {
    add(input.table_cell.sourceRef);
    return blocks;
  }
  return wordPlanWrittenBlocks(
    {
      entries: items(input.entries).flatMap((e): WordPlanEntry[] =>
        !object(e)
          ? []
          : e.kind === "insert"
            ? [
                {
                  kind: "insert",
                  contextRefs: strings(e.contextRefs),
                  blocks: [],
                },
              ]
            : e.kind === "keep"
              ? [{ kind: "keep", source: strings(e.source) }]
              : e.kind === "replace"
                ? [{ kind: "replace", source: strings(e.source), blocks: [] }]
                : [],
      ),
      deleted: items(input.deleted).flatMap((d) =>
        object(d) ? [{ source: strings(d.source), reason: "" }] : [],
      ),
      stories: items(input.stories).flatMap((s) =>
        object(s) && object(s.anchor) && typeof s.anchor.block === "string"
          ? [{ anchor: { block: s.anchor.block } }]
          : [],
      ),
    },
    snapshot,
  );
}

/** A part is the innermost heading or numbered section; text outside any is its own part. */
function partKey(sections: WordCaptureSections, block: number): string {
  const titled = wordTitledPart(sections, block);
  if (titled) return `t${titled.index}`;
  const entry = sections.entryOf[block];
  return entry >= 0 ? `p${entry}` : `b${block}`;
}

/** Each part the blocks lie in, with its first block in document order. */
function partsOf(
  sections: WordCaptureSections,
  blocks: ReadonlySet<number>,
): Map<string, number> {
  const parts = new Map<string, number>();
  for (const block of [...blocks].sort((a, b) => a - b)) {
    const key = partKey(sections, block);
    if (!parts.has(key)) parts.set(key, block);
  }
  return parts;
}

/**
 * The parts an earlier attempt of the same request changed that the accepted plan leaves out, by
 * their own titles (or first words), in document order. Only an earlier attempt that changed more
 * parts than the accepted plan counts, so a plan accepted at the first attempt, or a retry that
 * keeps every part, names none.
 */
export function wordPartsNotInProposal(
  snapshot: WordAuthoringSnapshot,
  earlier: readonly ReadonlySet<number>[],
  accepted: ReadonlySet<number>,
): string[] {
  if (!earlier.length) return [];
  const sections = wordCaptureSections(snapshot);
  const kept = partsOf(sections, accepted);
  const missing = new Map<string, number>();
  for (const attempt of earlier) {
    const changed = partsOf(sections, attempt);
    if (changed.size <= kept.size) continue;
    for (const [key, block] of changed)
      if (!kept.has(key) && block < (missing.get(key) ?? Infinity))
        missing.set(key, block);
  }
  const names: string[] = [];
  for (const block of [...missing.values()].sort((a, b) => a - b)) {
    const name =
      wordTitledPart(sections, block)?.title ??
      wordPassageStart(snapshot, block);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

const encoder = new TextEncoder();

/** What an accepted receipt adds when the plan leaves out parts an earlier attempt changed: the
 * card shows the names, and the note tells the model when a later turn replays the call. */
export function wordNotInProposalReceipt(
  names: readonly string[],
): { notInProposal: string[]; notInProposalNote: string } | undefined {
  if (!names.length) return undefined;
  const quoted = names.map((name) => `"${name}"`);
  const note = (count: number) =>
    `Not in this proposal: ${
      quoted.length > count
        ? `${quoted.slice(0, count).join(", ")} and other parts`
        : wordListedNames(quoted)
    }, which an earlier attempt of this request changed. The card tells the user the same; name them when you describe this proposal.`;
  let count = Math.min(MAX_NOTE_NAMES, quoted.length);
  while (
    count > 1 &&
    encoder.encode(JSON.stringify(note(count))).length > MAX_NOTE_BYTES
  )
    count--;
  return {
    notInProposal: names.slice(0, MAX_LISTED),
    notInProposalNote: note(count),
  };
}
