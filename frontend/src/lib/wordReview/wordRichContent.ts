import { inventoryWordNativeStructures } from "./wordInlineStructures";
import { inventoryWordMedia } from "./wordMediaContent";
import { readWordTableContent } from "./wordTableContent";

import type {
  WordAuthoringSnapshot,
  WordSourceBlock,
  WordPlanBlock,
} from "./wordDocumentPlan";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export function wordSourceDetails(
  source: string,
  ref: string,
): Pick<WordSourceBlock, "content" | "objects"> {
  const root = new DOMParser().parseFromString(
    source,
    "application/xml",
  ).documentElement;
  const tables = [
    root,
    ...Array.from(root.getElementsByTagNameNS(W, "tbl")),
  ].filter(
    (e, i, all) =>
      e.namespaceURI === W && e.localName === "tbl" && all.indexOf(e) === i,
  );
  const tableObjects = tables.map((table, i) => ({
    ref: `${ref}_table_${i + 1}`,
    kind: "table",
    selector: `table-${i + 1}`,
    table: readWordTableContent<WordPlanBlock>(table),
  }));
  const objects: Record<string, unknown>[] = [
    ...tableObjects,
    ...inventoryWordMedia(root, ref).map((o) => ({ ...o })),
    ...inventoryWordNativeStructures(root).map((o) => ({ ...o })),
  ];
  return {
    ...(tables.length === 1 ? { content: tableObjects[0].table } : {}),
    ...(objects.length ? { objects } : {}),
  };
}

export interface WordResolvedSource {
  xml: string;
  part: string;
  index?: number;
  kind?: "table" | "image" | "drawing";
}

/** Splits a nested object ref such as `b4_table_2` into its parent block and position. */
export function parseWordNestedRef(
  ref: string,
):
  | { parent: string; kind: "table" | "image" | "drawing"; index: number }
  | undefined {
  const match = /^(.*)_(table|image|drawing)_([1-9][0-9]*)$/.exec(ref);
  return match
    ? {
        parent: match[1],
        kind: match[2] as "table" | "image" | "drawing",
        index: Number(match[3]) - 1,
      }
    : undefined;
}

export function resolveWordSource(
  snapshot: WordAuthoringSnapshot,
  ref: string,
): WordResolvedSource | undefined {
  const sources = [
    ...snapshot.blocks.map((b) => ({
      ref: b.ref,
      xml: b.xml,
      part: "/word/document.xml",
    })),
    ...(snapshot.stories ?? []).map((s) => ({
      ref: `story_${s.id}`,
      xml: s.xml,
      part: s.part,
    })),
  ];
  const direct = sources.find((s) => s.ref === ref);
  if (direct) return direct;
  const nested = parseWordNestedRef(ref);
  if (!nested) return undefined;
  const parent = sources.find((s) => s.ref === nested.parent);
  if (!parent) return undefined;
  const detail = wordSourceDetails(parent.xml, parent.ref);
  if (!detail.objects?.some((o) => o.ref === ref)) return undefined;
  return {
    xml: parent.xml,
    part: parent.part,
    index: nested.index,
    kind: nested.kind,
  };
}
