import { captureWordAuthoringSnapshot } from "./wordDocumentXml";
import { createNativeContentSignature } from "./wordNativeContent";
import { removeWordNumberingIdentity } from "./wordXmlComparison";

import type { WordAuthoringSnapshot } from "./wordDocumentPlan";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** What an in-place write depends on in the captured document. */
export interface WordScopeRequest {
  /** Captured blocks the write changes, removes, writes next to or reads a list from. */
  touched: Iterable<string>;
  /** Paragraph styles and list instances the write applies, each reported on a captured block. */
  definitions: Iterable<{ ref: string; style?: string; numId?: string }>;
  /** The write adds a paragraph ahead of every surviving captured block (start) or after all of them
   * (end): nothing may have been added at that end of the body since the capture. */
  edges?: { start?: boolean; end?: boolean };
}

export type WordScopeRebase =
  | {
      ok: true;
      /** The live document as a snapshot; the captured one itself when nothing changed. */
      live: WordAuthoringSnapshot;
      /** Captured block reference -> live block reference, for every block the scope checked. */
      map: Map<string, string>;
      /** Blocks changed, added or removed outside the scope since the capture. */
      outsideChanges: number;
    }
  | { ok: false; locations: string[] };

const MAX_LOCATIONS = 8;
/** Beyond this many cell comparisons a gap counts every differing block instead of diffing them. */
const MAX_DIFF_CELLS = 1_000_000;

const cache = new WeakMap<WordAuthoringSnapshot, string[]>();

function blockSignatures(snapshot: WordAuthoringSnapshot): string[] {
  const cached = cache.get(snapshot);
  if (cached) return cached;
  const signature = createNativeContentSignature(snapshot.ooxml);
  const result = snapshot.blocks.map((block) => signature(block.xml));
  cache.set(snapshot, result);
  return result;
}

/** Blocks that differ between two runs of the document: max(length) minus their longest common subsequence. */
function changedBlocks(a: readonly string[], b: readonly string[]): number {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  const x = a.slice(start, a.length - end);
  const y = b.slice(start, b.length - end);
  if (!x.length || !y.length) return Math.max(x.length, y.length);
  if (x.length * y.length > MAX_DIFF_CELLS) return Math.max(x.length, y.length);
  let row = new Array<number>(y.length + 1).fill(0);
  for (const value of x) {
    const next = new Array<number>(y.length + 1).fill(0);
    for (let j = 0; j < y.length; j++)
      next[j + 1] = value === y[j] ? row[j] + 1 : Math.max(row[j + 1], next[j]);
    row = next;
  }
  return Math.max(x.length, y.length) - row[y.length];
}

const location = (index: number, issue: string) =>
  `/word/document.xml body block ${index + 1}: ${issue}`;

function indexOf(values: readonly string[]): Map<string, number[]> {
  const positions = new Map<string, number[]>();
  values.forEach((value, j) =>
    positions.set(value, [...(positions.get(value) ?? []), j]),
  );
  return positions;
}

/** Where `run` starts in `values`, each position a full match. */
function occurrences(
  values: readonly string[],
  positions: ReadonlyMap<string, number[]>,
  run: readonly string[],
): number[] {
  return (positions.get(run[0]) ?? []).filter((j) =>
    run.every((value, k) => values[j + k] === value),
  );
}

/** Paragraph styles (with what they are based on) and list instances, comparable across packages
 * regardless of list-definition identity. */
function definitionReader(ooxml: string) {
  const doc = new DOMParser().parseFromString(ooxml, "application/xml");
  removeWordNumberingIdentity(doc);
  const serializer = new XMLSerializer();
  const signature = createNativeContentSignature(
    serializer.serializeToString(doc),
  );
  const find = (local: string, attribute: string, value: string) =>
    Array.from(doc.getElementsByTagNameNS(W, local)).find(
      (e) => e.getAttributeNS(W, attribute) === value,
    );
  return {
    style(id: string): string {
      const chain: string[] = [];
      const seen = new Set<string>();
      for (let current = id; current && !seen.has(current); ) {
        seen.add(current);
        const style = find("style", "styleId", current);
        if (!style) {
          chain.push(`missing:${current}`);
          break;
        }
        chain.push(
          signature(serializer.serializeToString(style), "/word/styles.xml"),
        );
        const basedOn = Array.from(style.children).find(
          (e) => e.namespaceURI === W && e.localName === "basedOn",
        );
        current = basedOn?.getAttributeNS(W, "val") ?? "";
      }
      return JSON.stringify(chain);
    },
    list(numId: string): string {
      const num = find("num", "numId", numId);
      return num
        ? signature(serializer.serializeToString(num), "/word/numbering.xml")
        : "missing";
    },
  };
}

/**
 * Scope-local stale check for in-place writes. Every run of touched blocks, with the blocks on either
 * side, must appear exactly once in the captured document, and still exactly once in the live one and
 * in the captured order; the styles and list instances the write applies must be unchanged. Everything
 * else may have changed and is left as it is.
 */
export function rebaseWordSnapshot(
  snapshot: WordAuthoringSnapshot,
  live: { ooxml: string; fingerprint: string },
  request: WordScopeRequest,
): WordScopeRebase {
  if (live.fingerprint === snapshot.fingerprint)
    return {
      ok: true,
      live: snapshot,
      map: new Map(snapshot.blocks.map((b) => [b.ref, b.ref])),
      outsideChanges: 0,
    };
  const current = captureWordAuthoringSnapshot(
    live.ooxml,
    snapshot.identity,
    "Off",
    true,
    "verify",
  );
  if (current.issue || !current.blocks.length)
    return { ok: false, locations: ["/word/document.xml: issue"] };
  const order = new Map(snapshot.blocks.map((b, i) => [b.ref, i]));
  const scope = new Set<number>();
  for (const ref of request.touched) {
    const index = order.get(ref);
    if (index === undefined)
      return { ok: false, locations: ["/word/document.xml body: scope"] };
    for (const i of [index - 1, index, index + 1])
      if (i >= 0 && i < snapshot.blocks.length) scope.add(i);
  }
  const final = snapshot.blocks.length - 1;
  if (request.edges?.start) scope.add(0);
  if (request.edges?.end) scope.add(final);
  const captured = blockSignatures(snapshot);
  const signature = createNativeContentSignature(current.ooxml);
  const actual = current.blocks.map((block) => signature(block.xml));
  const positions = indexOf(actual);
  const capturedPositions = indexOf(captured);
  const windows: [number, number][] = [];
  for (const i of [...scope].sort((a, b) => a - b)) {
    const last = windows.at(-1);
    if (last && last[1] === i - 1) last[1] = i;
    else windows.push([i, i]);
  }
  const locations: string[] = [];
  const map = new Map<string, string>();
  let outsideChanges = 0;
  let capturedNext = 0;
  let liveNext = 0;
  for (const [start, end] of windows) {
    const length = end - start + 1;
    const run = captured.slice(start, end + 1);
    const matches = occurrences(actual, positions, run);
    // A run the captured document already held twice cannot be told apart from its copy once one
    // of them was edited: the remaining one would match uniquely and take the write.
    if (
      matches.length > 1 ||
      occurrences(captured, capturedPositions, run).length > 1
    ) {
      locations.push(location(start, "ambiguous"));
      continue;
    }
    if (matches.length !== 1) {
      // Report the first block of the run that no longer lines up.
      let best = 0;
      let at = -1;
      for (const j of positions.get(captured[start]) ?? []) {
        let k = 0;
        while (k < length && actual[j + k] === captured[start + k]) k++;
        if (k > best) [best, at] = [k, j];
      }
      const failed = start + best;
      locations.push(
        location(
          failed,
          at >= 0 && actual[at + best] === captured[failed + 1]
            ? "missing"
            : "changed",
        ),
      );
      continue;
    }
    const [j] = matches;
    if (j < liveNext) {
      locations.push(location(start, "changed"));
      continue;
    }
    const addedBefore = request.edges?.start && start === 0 && j !== 0;
    const addedAfter =
      request.edges?.end && end === final && j + length !== actual.length;
    if (addedBefore || addedAfter) {
      locations.push(location(addedBefore ? 0 : final, "changed"));
      continue;
    }
    outsideChanges += changedBlocks(
      captured.slice(capturedNext, start),
      actual.slice(liveNext, j),
    );
    for (let k = 0; k < length; k++)
      map.set(snapshot.blocks[start + k].ref, current.blocks[j + k].ref);
    capturedNext = end + 1;
    liveNext = j + length;
  }
  if (locations.length)
    return { ok: false, locations: locations.slice(0, MAX_LOCATIONS) };
  outsideChanges += changedBlocks(
    captured.slice(capturedNext),
    actual.slice(liveNext),
  );
  const definitions = [...request.definitions];
  if (definitions.length) {
    const before = definitionReader(snapshot.ooxml);
    const after = definitionReader(current.ooxml);
    for (const { ref, style, numId } of definitions) {
      const changed =
        (style !== undefined && before.style(style) !== after.style(style)) ||
        (numId !== undefined && before.list(numId) !== after.list(numId));
      if (changed) locations.push(location(order.get(ref) ?? 0, "definition"));
    }
    if (locations.length)
      return {
        ok: false,
        locations: [...new Set(locations)].slice(0, MAX_LOCATIONS),
      };
  }
  return { ok: true, live: current, map, outsideChanges };
}
