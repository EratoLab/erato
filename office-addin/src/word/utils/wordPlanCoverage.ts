import {
  canonicalWordPlan,
  MAX_NOT_IN_PROPOSAL_NAMES,
} from "@erato/frontend/word-review";

import { wordReadableSourceBlock } from "./wordAuthoringReadData";
import {
  START_OF_DOCUMENT,
  wordBlockIndex,
  wordCaptureSections,
} from "./wordDocumentOutline";
import {
  wordNamedParts,
  wordPassageName,
  wordPassageStart,
  wordPlanWrittenBlocks,
} from "./wordPlanDocumentChanges";
import { MAX_WORD_RECEIPT_FIELD_BYTES } from "./wordReadFreshness";
import { wordScopedEditBlocks } from "./wordScopedSubmission";
import { utf8ByteLength } from "../../core/clientActions/actionFacetArgs";

import type {
  WordCaptureSections,
  WordOutlineEntry,
} from "./wordDocumentOutline";
import type {
  WordAuthoringSnapshot,
  WordPlanEntry,
} from "@erato/frontend/word-review";

/** Bounds what a receipt stores. */
const MAX_LISTED = 20;

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const items = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): string[] =>
  items(v).filter((r): r is string => typeof r === "string");

const LOOK = [
  "type",
  "text",
  "level",
  "styleRef",
  "list",
  "ordered",
  "runs",
  "format",
] as const;

/** A full plan may re-emit untouched text as a replace; that changes nothing a retry could drop.
 * Compared with the read the model copies; the capture keeps runs the read joins or folds into the font. */
function unchangedReplace(
  source: string[],
  blocks: unknown[],
  snapshot: WordAuthoringSnapshot,
): boolean {
  const index = wordBlockIndex(snapshot);
  return (
    !!source.length &&
    source.length === blocks.length &&
    source.every((ref, k) => {
      const at = index.get(ref);
      const block = blocks[k];
      if (at === undefined || !object(block)) return false;
      const read = wordReadableSourceBlock(snapshot.blocks[at]);
      return LOOK.every(
        (key) => canonicalWordPlan(block[key]) === canonicalWordPlan(read[key]),
      );
    })
  );
}

/** Read leniently, so an attempt refused before parsing still counts; implied moves are left out, as
 * a refused plan's duplicated keep would read as one. */
export function wordSubmissionBlocks(
  input: unknown,
  snapshot: WordAuthoringSnapshot,
): Set<number> {
  if (!object(input)) return new Set();
  if (object(input.scoped_edit))
    return wordScopedEditBlocks(input.scoped_edit, snapshot);
  if (object(input.table_cell)) {
    const ref = input.table_cell.sourceRef;
    const at =
      typeof ref === "string" ? wordBlockIndex(snapshot).get(ref) : undefined;
    return new Set(at === undefined ? [] : [at]);
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
                ? [
                    unchangedReplace(
                      strings(e.source),
                      items(e.blocks),
                      snapshot,
                    )
                      ? { kind: "keep", source: strings(e.source) }
                      : {
                          kind: "replace",
                          source: strings(e.source),
                          blocks: [],
                        },
                  ]
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
    { moves: false },
  );
}

/** The body blocks this request read for writing: its complete read's and every scoped read's. */
function readBlocks(snapshot: WordAuthoringSnapshot): Set<number> {
  const refs = new Set(snapshot.read);
  for (const scope of snapshot.readScopes?.values() ?? [])
    if (scope.kind === "objects")
      for (const target of scope.targets) {
        if (target.bodyRef) refs.add(target.bodyRef);
      }
    else refs.add(scope.sourceRef);
  const index = wordBlockIndex(snapshot);
  return new Set(
    [...refs].flatMap((ref) => {
      const at = index.get(ref);
      return at === undefined ? [] : [at];
    }),
  );
}

const titled = (entry: WordOutlineEntry | undefined) =>
  !!entry &&
  entry.tag !== "P" &&
  !!entry.title &&
  entry.title !== START_OF_DOCUMENT;

/** The titled parts that hold a block, outermost first; a block outside all of them is in one
 * untitled part, keyed by its outline entry. */
function partChain(sections: WordCaptureSections, block: number): string[] {
  const chain = sections.outline
    .map((entry, k) => ({ entry, k }))
    .filter(
      ({ entry }) => titled(entry) && entry.from <= block && block < entry.to,
    )
    .sort((a, b) => a.entry.level - b.entry.level)
    .map(({ k }) => String(k));
  if (chain.length) return chain;
  const entry = sections.entryOf[block];
  return [entry >= 0 ? String(entry) : "start"];
}

/** For each part the blocks change, and "" for the whole document, the parts directly under it
 * that they change. */
function partTree(
  chainOf: (block: number) => string[],
  blocks: Iterable<number>,
): Map<string, Set<string>> {
  const tree = new Map<string, Set<string>>([["", new Set()]]);
  for (const block of blocks) {
    let parent = "";
    for (const key of chainOf(block)) {
      tree.get(parent)!.add(key);
      if (!tree.has(key)) tree.set(key, new Set());
      parent = key;
    }
  }
  return tree;
}

/** A left-out part by its own title, else by the first words of its text; neither when it has none. */
export interface WordLeftOutPart {
  title?: string;
  passage?: string;
}

function leftOutPart(
  snapshot: WordAuthoringSnapshot,
  sections: WordCaptureSections,
  key: string,
  changed: readonly number[],
): WordLeftOutPart {
  const entry = key === "start" ? undefined : sections.outline[Number(key)];
  if (titled(entry)) return { title: entry!.title };
  const span = entry
    ? Array.from({ length: entry.to - entry.from }, (_, i) => entry.from + i)
    : [];
  for (const block of [...changed, ...span]) {
    const passage = wordPassageStart(snapshot, block);
    if (passage) return { passage };
  }
  return {};
}

/** An attempt counts only when it changed more parts at some level, so a moved change names none;
 * only read blocks count, so a mistyped ref the host refused names none. */
export function wordPartsNotInProposal(
  snapshot: WordAuthoringSnapshot,
  earlier: readonly ReadonlySet<number>[],
  accepted: ReadonlySet<number>,
): WordLeftOutPart[] {
  if (!earlier.length) return [];
  const sections = wordCaptureSections(snapshot);
  const chains = new Map<number, string[]>();
  const chainOf = (block: number) => {
    let chain = chains.get(block);
    if (!chain) chains.set(block, (chain = partChain(sections, block)));
    return chain;
  };
  const kept = partTree(chainOf, accepted);
  const read = readBlocks(snapshot);
  const missing = new Map<string, number[]>();
  for (const attempt of earlier) {
    const blocks = [...attempt]
      .filter((b) => read.has(b))
      .sort((a, b) => a - b);
    const fewer = [...partTree(chainOf, blocks)].some(
      ([parent, children]) =>
        children.size > (kept.get(parent)?.size ?? Infinity),
    );
    if (!fewer) continue;
    for (const block of blocks) {
      const key = chainOf(block).find((k) => !kept.has(k));
      if (key) missing.set(key, [...(missing.get(key) ?? []), block]);
    }
  }
  const parts: WordLeftOutPart[] = [];
  const seen = new Set<string>();
  for (const [key, changed] of [...missing]
    .map(([key, changed]) => [key, changed.sort((a, b) => a - b)] as const)
    .sort(([, a], [, b]) => a[0] - b[0])) {
    const part = leftOutPart(snapshot, sections, key, changed);
    const name = JSON.stringify(part);
    if (seen.has(name)) continue;
    seen.add(name);
    parts.push(part);
  }
  return parts;
}

/** `notInProposal` is for the card, the note for the model when a later turn replays the call; an
 * empty card name stands for a part without text. */
export function wordNotInProposalReceipt(
  parts: readonly WordLeftOutPart[],
  /** Why each was meant to change. */
  reason = "which an earlier attempt of this request changed",
): { notInProposal: string[]; notInProposalNote: string } | undefined {
  if (!parts.length) return undefined;
  const spoken = parts.map((part) =>
    part.title !== undefined
      ? `"${part.title}"`
      : part.passage !== undefined
        ? wordPassageName(part.passage)
        : "a part without text",
  );
  const note = (count: number) =>
    `Not in this proposal: ${wordNamedParts(spoken, count)}, ${reason}. The card tells the user the same; name them when you describe this proposal.`;
  let count = Math.min(MAX_NOT_IN_PROPOSAL_NAMES, spoken.length);
  while (
    count > 1 &&
    utf8ByteLength(JSON.stringify(note(count))) > MAX_WORD_RECEIPT_FIELD_BYTES
  )
    count--;
  return {
    notInProposal: parts
      .slice(0, MAX_LISTED)
      .map(
        (part) =>
          part.title ?? (part.passage !== undefined ? `“${part.passage}”` : ""),
      ),
    notInProposalNote: note(count),
  };
}
