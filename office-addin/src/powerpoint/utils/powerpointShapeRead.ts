import type { PowerPointReadSupport } from "./powerpointReadSupport";

/** A shape as the reads return it; box values are points. */
export interface PowerPointShapeOut {
  id: string;
  name: string;
  type: string;
  box: { left: number; top: number; width: number; height: number };
  text?: string;
  /** Placeholder role (title, body…); full tier only. */
  role?: string;
  /** What a placeholder holds when it is not text, e.g. Table or Chart. */
  holds?: string;
  paragraphs?: PowerPointParagraphOut[];
  table?: { rows: number; columns: number; values: string[][] };
  children?: PowerPointShapeOut[];
  z?: number;
  rotation?: number;
  visible?: boolean;
  altText?: { title?: string; description?: string };
  decorative?: boolean;
  /** What exists in this shape but was not read, and why. Never means "empty". */
  unread?: string[];
}

export interface PowerPointParagraphOut {
  text: string;
  level: number;
  bullet?: string;
}

/** Shape types whose content no PowerPoint API exposes. */
const OPAQUE_CONTENT: Record<string, string> = {
  Chart: "chart data (no PowerPoint API reads it)",
  Diagram: "SmartArt text (no PowerPoint API reads it)",
  SmartArt: "SmartArt text (no PowerPoint API reads it)",
  Graphic: "graphic content",
  Image: "picture content",
  Media: "media content",
  Ole: "embedded object content",
  ContentApp: "add-in content",
  Model3D: "3D model content",
  Ink: "ink content",
};

/**
 * Below 1.10 `.textFrame` makes the whole batch fail on tables, pictures, charts and groups, so the
 * basic tier asks only these types for text. A placeholder can still hold a table or a picture;
 * that one falls back to its own batch.
 */
const BASIC_TEXT_TYPES = new Set([
  "GeometricShape",
  "TextBox",
  "Placeholder",
  "Callout",
  "Freeform",
]);

const TITLE_ROLES = new Set(["Title", "CenterTitle", "VerticalTitle"]);
export const isTitleRole = (role: string | undefined) =>
  !!role && TITLE_ROLES.has(role);

export const MAX_GROUP_DEPTH = 3;
const MAX_PARAGRAPHS_PER_SHAPE = 60;
const MAX_TEXT_CHARACTERS = 4000;
const MAX_TABLE_CELLS = 400;

const FAILED = Symbol("failed");
type Read<R> = R | typeof FAILED;

/**
 * Queues one read per item and syncs once. If the batch fails, each item is read again in a batch
 * of its own, so one shape PowerPoint refuses does not lose the others.
 */
export async function readEach<T, R>(
  context: PowerPoint.RequestContext,
  items: readonly T[],
  queue: (item: T) => () => R,
): Promise<Read<R>[]> {
  if (items.length === 0) return [];
  const take = (reader: () => R): Read<R> => {
    try {
      return reader();
    } catch {
      return FAILED;
    }
  };
  const readers = items.map(queue);
  try {
    await context.sync();
    return readers.map(take);
  } catch {
    if (items.length === 1) return [FAILED];
  }
  const results: Read<R>[] = [];
  for (const item of items) {
    const reader = queue(item);
    try {
      await context.sync();
      results.push(take(reader));
    } catch {
      results.push(FAILED);
    }
  }
  return results;
}

export const failed = <R>(value: Read<R>): value is typeof FAILED =>
  value === FAILED;

const BASE_FIELDS = ["id", "name", "type", "left", "top", "width", "height"];
const FULL_FIELDS = [
  "zOrderPosition",
  "rotation",
  "visible",
  "altTextTitle",
  "altTextDescription",
  "isDecorative",
];

export function shapeLoadPaths(support: PowerPointReadSupport): string {
  const fields = [
    ...BASE_FIELDS,
    ...(support.zOrder ? ["zOrderPosition"] : []),
    ...(support.shapeDetails ? FULL_FIELDS.slice(1) : []),
  ];
  return fields.map((field) => `items/${field}`).join(",");
}

const points = (value: number) => Math.round(value * 10) / 10;

/** Paragraphs end in \r on desktop and \n on the web; a soft line break inside one is \v. */
export function powerpointParagraphSpans(
  raw: string,
): { start: number; length: number }[] {
  const spans: { start: number; length: number }[] = [];
  const pattern = /\r\n|\r|\n/g;
  let start = 0;
  for (const match of raw.matchAll(pattern)) {
    spans.push({ start, length: match.index - start });
    start = match.index + match[0].length;
  }
  spans.push({ start, length: raw.length - start });
  return spans;
}

export function normalizePowerPointText(raw: string): string {
  return raw.replace(/\r\n|\r/g, "\n").replace(/\v/g, "\n");
}

export function capText(text: string): string {
  if (text.length <= MAX_TEXT_CHARACTERS) return text;
  return `${text.slice(0, MAX_TEXT_CHARACTERS)}…[cut: ${text.length - MAX_TEXT_CHARACTERS} more characters]`;
}

function capTable(values: string[][]): string[][] {
  let cells = 0;
  const rows: string[][] = [];
  for (const row of values) {
    if (cells + row.length > MAX_TABLE_CELLS) break;
    cells += row.length;
    rows.push(row.map((cell) => capText(normalizePowerPointText(cell))));
  }
  return rows;
}

/** Top-then-left, the order a reader most likely takes; PowerPoint keeps no reading order. */
export function readingOrder<T extends { box: { top: number; left: number } }>(
  shapes: T[],
): T[] {
  return shapes
    .map((shape, index) => ({ shape, index }))
    .sort(
      (a, b) =>
        a.shape.box.top - b.shape.box.top ||
        a.shape.box.left - b.shape.box.left ||
        a.index - b.index,
    )
    .map(({ shape }) => shape);
}

interface Pending {
  proxy: PowerPoint.Shape;
  out: PowerPointShapeOut;
  raw?: string;
}

/**
 * Reads a loaded shape collection's content. The shapes' own fields (shapeLoadPaths) must already
 * be loaded and synced.
 */
export async function readShapeContent(
  context: PowerPoint.RequestContext,
  shapes: readonly PowerPoint.Shape[],
  support: PowerPointReadSupport,
  depth = 0,
): Promise<PowerPointShapeOut[]> {
  const pending: Pending[] = shapes.map((proxy) => ({
    proxy,
    out: baseShape(proxy, support),
  }));
  const full = support.tier === "full";

  if (support.placeholderRole) {
    const placeholders = pending.filter((p) => p.out.type === "Placeholder");
    const roles = await readEach(context, placeholders, ({ proxy }) => {
      const format = proxy.placeholderFormat.load("type,containedType");
      return () => ({ type: format.type, holds: format.containedType });
    });
    placeholders.forEach((p, i) => {
      const role = roles[i];
      if (failed(role)) return;
      p.out.role = role.type;
      if (role.holds && role.holds !== "Placeholder") p.out.holds = role.holds;
    });
  }

  const contentType = (p: Pending) => p.out.holds ?? p.out.type;
  let textCandidates = pending.filter((p) =>
    full
      ? contentType(p) !== "Table" && contentType(p) !== "Group"
      : BASIC_TEXT_TYPES.has(p.out.type),
  );
  if (full) {
    const hasText = await readEach(context, textCandidates, ({ proxy }) => {
      const frame = proxy.getTextFrameOrNullObject().load("hasText");
      return () => !frame.isNullObject && frame.hasText;
    });
    textCandidates = textCandidates.filter((_, i) => hasText[i] !== false);
  }
  const texts = await readEach(context, textCandidates, ({ proxy }) => {
    const frame = full ? proxy.getTextFrameOrNullObject() : proxy.textFrame;
    const range = frame.textRange.load("text");
    return () => range.text;
  });
  textCandidates.forEach((p, i) => {
    const raw = texts[i];
    if (failed(raw)) {
      if (!full && p.out.type === "Placeholder")
        p.out.unread = [
          "placeholder content: this host reads only text placeholders",
        ];
      else markUnread(p.out, "text: PowerPoint refused to read it");
      return;
    }
    if (raw) {
      p.raw = raw;
      p.out.text = capText(normalizePowerPointText(raw));
    }
  });

  const tableShapes = pending.filter((p) => contentType(p) === "Table");
  if (support.tables) {
    const tables = await readEach(context, tableShapes, ({ proxy }) => {
      const table = proxy.getTable().load("rowCount,columnCount,values");
      return () => ({
        rows: table.rowCount,
        columns: table.columnCount,
        values: table.values,
      });
    });
    tableShapes.forEach((p, i) => {
      const table = tables[i];
      if (failed(table)) {
        markUnread(p.out, "table contents: PowerPoint refused to read them");
        return;
      }
      const values = capTable(table.values);
      p.out.table = { rows: table.rows, columns: table.columns, values };
      if (values.length < table.values.length)
        markUnread(
          p.out,
          `table rows ${values.length + 1}-${table.values.length}: cut to keep the result small`,
        );
    });
  } else {
    tableShapes.forEach((p) =>
      markUnread(
        p.out,
        "table contents: this PowerPoint version cannot read tables (needs PowerPointApi 1.8)",
      ),
    );
  }

  if (support.bulletLevels) await readParagraphs(context, pending);

  for (const p of pending) {
    const opaque = OPAQUE_CONTENT[contentType(p)];
    if (opaque) markUnread(p.out, opaque);
  }

  const groups = pending.filter((p) => p.out.type === "Group");
  for (const p of groups) {
    if (!support.groups) {
      markUnread(
        p.out,
        "group children: this PowerPoint version cannot read inside groups (needs PowerPointApi 1.8)",
      );
      continue;
    }
    if (depth + 1 >= MAX_GROUP_DEPTH) {
      markUnread(p.out, "group children: nested too deep to read");
      continue;
    }
    try {
      const children = p.proxy.group.shapes.load(shapeLoadPaths(support));
      await context.sync();
      p.out.children = readingOrder(
        await readShapeContent(context, children.items, support, depth + 1),
      );
    } catch {
      markUnread(p.out, "group children: PowerPoint refused to read them");
    }
  }

  return pending.map((p) => p.out);
}

function markUnread(out: PowerPointShapeOut, what: string) {
  out.unread = [...(out.unread ?? []), what];
}

function baseShape(
  proxy: PowerPoint.Shape,
  support: PowerPointReadSupport,
): PowerPointShapeOut {
  const out: PowerPointShapeOut = {
    id: proxy.id,
    name: proxy.name,
    type: proxy.type,
    box: {
      left: points(proxy.left),
      top: points(proxy.top),
      width: points(proxy.width),
      height: points(proxy.height),
    },
  };
  if (support.zOrder) out.z = proxy.zOrderPosition;
  if (support.shapeDetails) {
    if (proxy.rotation) out.rotation = proxy.rotation;
    if (proxy.visible === false) out.visible = false;
    if (proxy.isDecorative) out.decorative = true;
    const title = proxy.altTextTitle || undefined;
    const description = proxy.altTextDescription || undefined;
    if (title || description)
      out.altText = {
        ...(title ? { title: capText(title) } : {}),
        ...(description ? { description: capText(description) } : {}),
      };
  }
  return out;
}

/** Per paragraph indent level and bullet; a shape whose paragraphs are all plain level 1 gets none. */
async function readParagraphs(
  context: PowerPoint.RequestContext,
  pending: readonly Pending[],
) {
  const items = pending.flatMap((p) =>
    p.raw
      ? powerpointParagraphSpans(p.raw)
          .slice(0, MAX_PARAGRAPHS_PER_SHAPE)
          .map((span) => ({ p, span }))
      : [],
  );
  const formats = await readEach(context, items, ({ p, span }) => {
    if (span.length === 0) return () => null;
    const range = p.proxy
      .getTextFrameOrNullObject()
      .textRange.getSubstring(span.start, span.length);
    const format = range.paragraphFormat.load("indentLevel");
    const bullet = format.bulletFormat.load("visible,type,style");
    return () => ({
      level: format.indentLevel,
      bullet: bullet.visible
        ? bullet.style && bullet.style !== "Unsupported"
          ? bullet.style
          : (bullet.type ?? "Unsupported")
        : undefined,
    });
  });
  const byShape = new Map<Pending, PowerPointParagraphOut[]>();
  items.forEach(({ p, span }, i) => {
    const format = formats[i];
    const raw = p.raw ?? "";
    const text = normalizePowerPointText(
      raw.slice(span.start, span.start + span.length),
    );
    const list = byShape.get(p) ?? [];
    list.push(
      failed(format) || format === null
        ? { text, level: 1 }
        : {
            text,
            level: format.level,
            ...(format.bullet ? { bullet: format.bullet } : {}),
          },
    );
    byShape.set(p, list);
  });
  for (const [p, paragraphs] of byShape) {
    if (paragraphs.some((paragraph) => paragraph.bullet || paragraph.level > 1))
      p.out.paragraphs = paragraphs.map((paragraph) => ({
        ...paragraph,
        text: capText(paragraph.text),
      }));
  }
}
