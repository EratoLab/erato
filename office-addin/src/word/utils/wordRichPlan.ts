import {
  parseWordParagraphFormatting,
  parseWordRunFormatting,
} from "./wordBlockFormatting";
import {
  isWordFieldSpec,
  isWordBookmarkSpec,
  isWordContentControlSpec,
  isWordNativeStructureEdit,
} from "./wordInlineStructures";
import { isWordImageSpec, isWordDrawingSpec } from "./wordMediaContent";
import { wordPlanError } from "./wordPlanDiagnostics";
import { parseWordTableBlock } from "./wordTableContent";

import type { WordPlanBlock, WordPlanRun } from "./wordDocumentPlan";
import type { WordPlanDiagnostics } from "./wordPlanDiagnostics";

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).every((k) => allowed.includes(k));
const id = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const text = (v: unknown): v is string =>
  typeof v === "string" &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);

/** Bounded typed vocabulary. Model strings never become markup. */
export function parseWordBlock(
  value: unknown,
  depth = 0,
  issues?: WordPlanDiagnostics,
  path = "",
): WordPlanBlock | null {
  const fail = (code: string, message: string, at = path) =>
    wordPlanError(issues, at, code, message);
  if (!object(value) || !id(value.id) || depth > 12)
    return fail(
      "block-shape",
      "Each block needs an identifier of 1–100 letters, digits, underscores or hyphens; nesting cannot exceed 12.",
    );
  const parseChild = (v: unknown, childPath = path) =>
    parseWordBlock(v, depth + 1, issues, childPath);
  const validChild = (v: unknown): v is WordPlanBlock => parseChild(v) !== null;
  const normalize = (blocks: unknown[]) => blocks.map((v) => parseChild(v)!);
  if (value.type === "table") {
    const table = parseWordTableBlock(value, parseChild, issues, path);
    if (!table) return null;
    return {
      ...table,
      text: table.rows
        .map((row) =>
          row.cells
            .map((cell) => cell.blocks?.map((b) => b.text).join("\n") ?? "")
            .join("\t"),
        )
        .join("\n"),
    };
  }
  if (value.type === "image") {
    if (
      !keys(value, ["id", "type", "text", "image"]) ||
      !isWordImageSpec(value.image)
    )
      return fail(
        "image-shape",
        "Invalid image specification; use the corresponding read-tool contract.",
        `${path}/image`,
      );
    return {
      id: value.id,
      type: "image",
      text: value.image.alt ?? "",
      image: value.image,
    };
  }
  if (value.type === "drawing") {
    if (
      !keys(value, ["id", "type", "text", "drawing"]) ||
      !isWordDrawingSpec(value.drawing)
    )
      return fail(
        "drawing-shape",
        "Invalid drawing specification; use the corresponding read-tool contract.",
        `${path}/drawing`,
      );
    return {
      id: value.id,
      type: "drawing",
      text: value.drawing.text ?? "",
      drawing: value.drawing,
    };
  }
  if (value.type === "field") {
    if (
      !keys(value, ["id", "type", "text", "field"]) ||
      !isWordFieldSpec(value.field)
    )
      return fail(
        "field-shape",
        "Invalid field specification; use the corresponding read-tool contract.",
        `${path}/field`,
      );
    return {
      id: value.id,
      type: "field",
      text: value.field.text,
      field: value.field,
    };
  }
  if (value.type === "bookmark") {
    if (
      !keys(value, ["id", "type", "text", "bookmark"]) ||
      !isWordBookmarkSpec(value.bookmark, validChild)
    )
      return fail(
        "bookmark-shape",
        "Invalid bookmark specification; use the corresponding read-tool contract.",
        `${path}/bookmark`,
      );
    const children = normalize(value.bookmark.children);
    return {
      id: value.id,
      type: "bookmark",
      text: children.map((b) => b.text).join("\n"),
      bookmark: { ...value.bookmark, children },
    };
  }
  if (value.type === "content-control") {
    if (
      !keys(value, ["id", "type", "text", "control"]) ||
      !isWordContentControlSpec(value.control, validChild)
    )
      return fail(
        "content-control-shape",
        "Invalid content-control specification; use the corresponding read-tool contract.",
        `${path}/control`,
      );
    const children = normalize(value.control.children);
    return {
      id: value.id,
      type: "content-control",
      text: children.map((b) => b.text).join("\n"),
      control: { ...value.control, children },
    };
  }
  if (value.type === "native-edit") {
    if (
      !keys(value, ["id", "type", "text", "sourceRef", "edits"]) ||
      !id(value.sourceRef) ||
      !Array.isArray(value.edits) ||
      !value.edits.length ||
      value.edits.length > 2000 ||
      !value.edits.every((e) => isWordNativeStructureEdit(e, validChild))
    )
      return fail(
        "native-edit-shape",
        "Invalid native-edit specification; use the corresponding read-tool contract.",
        `${path}/edits`,
      );
    return {
      id: value.id,
      type: "native-edit",
      text: "",
      sourceRef: value.sourceRef,
      edits: value.edits.map((e) =>
        e.kind === "content-control" && e.children
          ? { ...e, children: normalize(e.children) }
          : e,
      ),
    } as WordPlanBlock;
  }
  if (
    !keys(value, [
      "id",
      "type",
      "text",
      "runs",
      "level",
      "styleRef",
      "list",
      "ordered",
      "format",
    ]) ||
    !text(value.text) ||
    /[\r\n]/.test(value.text)
  )
    return fail(
      "paragraph-shape",
      "Text blocks require text without newlines or control characters and only the documented fields.",
    );
  if (
    value.runs !== undefined &&
    (!Array.isArray(value.runs) ||
      value.runs.length > 2000 ||
      !value.runs.every(
        (r) =>
          object(r) &&
          text(r.text) &&
          parseWordRunFormatting(r, ["text"]) !== null,
      ) ||
      value.runs.map((r: WordPlanRun) => r.text).join("") !== value.text)
  )
    return fail(
      "runs-shape",
      "Runs must use supported formatting and concatenate exactly to text.",
      `${path}/runs`,
    );
  if (value.format !== undefined && !parseWordParagraphFormatting(value.format))
    return fail(
      "paragraph-format",
      "Invalid paragraph formatting. Use only the properties, units and values in paragraphFormatting.",
      `${path}/format`,
    );
  if (
    value.styleRef !== undefined &&
    (typeof value.styleRef !== "string" || value.styleRef.length > 200)
  )
    return fail(
      "style-shape",
      "styleRef must be a string of at most 200 characters.",
      `${path}/styleRef`,
    );
  if (value.type === "paragraph") {
    if (
      value.level !== undefined ||
      value.list !== undefined ||
      value.ordered !== undefined
    )
      return fail(
        "paragraph-fields",
        "Paragraphs do not accept level, list or ordered.",
      );
  } else if (value.type === "heading") {
    if (
      !Number.isInteger(value.level) ||
      Number(value.level) < 1 ||
      Number(value.level) > 9 ||
      value.list !== undefined ||
      value.ordered !== undefined ||
      value.styleRef !== undefined
    )
      return fail(
        "heading-fields",
        "Headings require level 1–9; styleRef, list and ordered are not supported.",
      );
  } else if (value.type === "list-item") {
    if (
      !id(value.list) ||
      typeof value.ordered !== "boolean" ||
      !Number.isInteger(value.level) ||
      Number(value.level) < 0 ||
      Number(value.level) > 8
    )
      return fail(
        "list-fields",
        "List items require a list identifier, ordered boolean and level 0–8.",
      );
  } else
    return fail(
      "block-type",
      "Unsupported block type; use supportedBlocks from the read tool.",
      `${path}/type`,
    );
  return value as unknown as WordPlanBlock;
}

export function wordBlockChildren(block: WordPlanBlock): WordPlanBlock[] {
  return wordBlockChildEntries(block, "").map((entry) => entry.block);
}

export function wordBlockChildEntries(
  block: WordPlanBlock,
  path: string,
): { block: WordPlanBlock; path: string }[] {
  const entries = (blocks: WordPlanBlock[], prefix: string) =>
    blocks.map((child, i) => ({ block: child, path: `${prefix}/${i}` }));
  switch (block.type) {
    case "table":
      return block.rows.flatMap((row, r) =>
        row.cells.flatMap((cell, c) =>
          entries(cell.blocks ?? [], `${path}/rows/${r}/cells/${c}/blocks`),
        ),
      );
    case "bookmark":
      return entries(block.bookmark.children, `${path}/bookmark/children`);
    case "content-control":
      return entries(block.control.children, `${path}/control/children`);
    case "native-edit":
      return block.edits.flatMap((e, i) =>
        e.kind === "content-control"
          ? entries(e.children ?? [], `${path}/edits/${i}/children`)
          : [],
      );
    default:
      return [];
  }
}
