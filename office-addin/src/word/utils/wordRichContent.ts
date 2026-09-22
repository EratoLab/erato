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
  const match = /^(.*)_(table|image|drawing)_([1-9][0-9]*)$/.exec(ref);
  if (!match) return undefined;
  const parent = sources.find((s) => s.ref === match[1]);
  if (!parent) return undefined;
  const detail = wordSourceDetails(parent.xml, parent.ref);
  if (!detail.objects?.some((o) => o.ref === ref)) return undefined;
  return {
    xml: parent.xml,
    part: parent.part,
    index: Number(match[3]) - 1,
    kind: match[2] as WordResolvedSource["kind"],
  };
}
