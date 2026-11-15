import type { PowerPointReadSupport } from "./powerpointReadSupport";

/** A shape as the reads return it; box values are points. */
export interface PowerPointShapeOut {
  id: string;
  name: string;
  type: string;
  box: { left: number; top: number; width: number; height: number };
  /** Absent when `paragraphs` carries the text. */
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
  /** Absent past MAX_PARAGRAPHS_PER_SHAPE, where levels are not read. */
  level?: number;
  bullet?: string;
}

/**
 * The switches whose absence this host's results report, each with how a gap reads to the model.
 * Results, unread notes and the chip all derive from the same switches.
 */
export const POWERPOINT_HOST_LIMITS = {
  placeholderRole: "placeholder roles (which shape is the title)",
  tables: "table contents",
  groups: "shapes inside groups",
  zOrder: "z-order",
  shapeDetails: "alt text, rotation and visibility",
  bulletLevels: "bullets and indent levels",
  slideSize: "slide size",
} as const satisfies Partial<Record<keyof PowerPointReadSupport, string>>;

export const hostCannot = (feature: keyof typeof POWERPOINT_HOST_LIMITS) =>
  `${POWERPOINT_HOST_LIMITS[feature]}: this PowerPoint version cannot read them (needs PowerPointApi 1.10)`;

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
 * Below 1.10 `.textFrame` fails the whole batch on tables, pictures, charts and groups, so only
 * these types are asked for text. A placeholder can still hold a table or a picture; readEach
 * isolates that one.
 */
const TEXT_TYPES = new Set([
  "GeometricShape",
  "TextBox",
  "Placeholder",
  "Callout",
  "Freeform",
]);

const TITLE_ROLES = new Set(["Title", "CenterTitle", "VerticalTitle"]);
export const isTitleRole = (role: string | undefined) =>
  !!role && TITLE_ROLES.has(role);

/** Assumed until measured natively: the top level is 1 and deeper paragraphs count up. */
export const TOP_INDENT_LEVEL = 1;

export const MAX_GROUP_DEPTH = 3;
const MAX_PARAGRAPHS_PER_SHAPE = 60;
const MAX_TEXT_CHARACTERS = 4000;
const MAX_TABLE_CELLS = 400;

const FAILED = Symbol("failed");
type Read<R> = R | typeof FAILED;

export const failed = <R>(value: Read<R>): value is typeof FAILED =>
  value === FAILED;

/**
 * Queues one read per item and syncs once. A failed batch is split in halves and each half tried
 * again, so k refused items cost about 2k·log2(n) syncs instead of one per item.
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
  const attempt = async (batch: readonly T[]): Promise<Read<R>[]> => {
    const readers = batch.map(queue);
    try {
      await context.sync();
      return readers.map(take);
    } catch {
      if (batch.length === 1) return [FAILED];
    }
    const middle = Math.ceil(batch.length / 2);
    return [
      ...(await attempt(batch.slice(0, middle))),
      ...(await attempt(batch.slice(middle))),
    ];
  };
  return attempt(items);
}

const BASE_FIELDS = ["id", "name", "type", "left", "top", "width", "height"];
const DETAIL_FIELDS = [
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
    ...(support.shapeDetails ? DETAIL_FIELDS : []),
  ];
  return fields.map((field) => `items/${field}`).join(",");
}

const points = (value: number) => Math.round(value * 10) / 10;

/**
 * Assumed, not measured: paragraphs end in \r on desktop and \n on the web, a soft line break is
 * \v, and string offsets match the host's character positions for getSubstring.
 */
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

export function capText(text: string, max = MAX_TEXT_CHARACTERS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…[cut: ${text.length - max} more characters]`;
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

function markUnread(out: PowerPointShapeOut, what: string) {
  out.unread = [...(out.unread ?? []), what];
}

const contentType = (p: Pending) => p.out.holds ?? p.out.type;

/**
 * Reads a loaded shape collection's content. The shapes' own fields (shapeLoadPaths) must already
 * be loaded and synced. Each step is one batch for all shapes, and groups are read level by level,
 * so the number of syncs does not grow with the number of shapes.
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
      if (role.holds && !TEXT_TYPES.has(role.holds)) p.out.holds = role.holds;
    });
  }

  await readTexts(context, pending, support);
  await readTables(context, pending, support);
  if (support.bulletLevels) await readParagraphs(context, pending);

  for (const p of pending) {
    const opaque = OPAQUE_CONTENT[contentType(p)];
    if (opaque) markUnread(p.out, opaque);
    else if (contentType(p) === "Unsupported" && p.out.text === undefined)
      markUnread(
        p.out,
        "content: PowerPoint does not describe this shape type",
      );
  }

  await readGroups(context, pending, support, depth);
  return pending.map((p) => p.out);
}

async function readTexts(
  context: PowerPoint.RequestContext,
  pending: readonly Pending[],
  support: PowerPointReadSupport,
) {
  const safe = support.safeTextFrame;
  let candidates = pending.filter((p) =>
    safe
      ? TEXT_TYPES.has(contentType(p)) || contentType(p) === "Unsupported"
      : TEXT_TYPES.has(p.out.type),
  );
  if (safe) {
    const hasText = await readEach(context, candidates, ({ proxy }) => {
      const frame = proxy.getTextFrameOrNullObject().load("hasText");
      return () => !frame.isNullObject && frame.hasText;
    });
    candidates = candidates.filter((_, i) => hasText[i] !== false);
  }
  const texts = await readEach(context, candidates, ({ proxy }) => {
    const frame = safe ? proxy.getTextFrameOrNullObject() : proxy.textFrame;
    const range = frame.textRange.load("text");
    return () => range.text;
  });
  candidates.forEach((p, i) => {
    const raw = texts[i];
    if (failed(raw) || typeof raw !== "string") {
      markUnread(
        p.out,
        !safe && p.out.type === "Placeholder"
          ? "placeholder content: it holds something other than text, which this PowerPoint version cannot tell apart"
          : "text: PowerPoint refused to read it",
      );
      return;
    }
    if (raw) {
      p.raw = raw;
      p.out.text = capText(normalizePowerPointText(raw));
    }
  });
}

function capTable(values: string[][]): string[][] {
  let cells = 0;
  const rows: string[][] = [];
  for (const row of values) {
    if (cells + row.length > MAX_TABLE_CELLS) break;
    cells += row.length;
    rows.push(row.map((cell) => capText(normalizePowerPointText(cell), 500)));
  }
  return rows;
}

async function readTables(
  context: PowerPoint.RequestContext,
  pending: readonly Pending[],
  support: PowerPointReadSupport,
) {
  const tableShapes = pending.filter((p) => contentType(p) === "Table");
  if (!support.tables) {
    tableShapes.forEach((p) => markUnread(p.out, hostCannot("tables")));
    return;
  }
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
}

async function readGroups(
  context: PowerPoint.RequestContext,
  pending: readonly Pending[],
  support: PowerPointReadSupport,
  depth: number,
) {
  const groups = pending.filter((p) => p.out.type === "Group");
  if (!support.groups) {
    groups.forEach((p) => markUnread(p.out, hostCannot("groups")));
    return;
  }
  if (depth + 1 >= MAX_GROUP_DEPTH) {
    groups.forEach((p) =>
      markUnread(p.out, "group children: nested too deep to read"),
    );
    return;
  }
  const lists = await readEach(context, groups, ({ proxy }) => {
    const children = proxy.group.shapes.load(shapeLoadPaths(support));
    return () => children.items;
  });
  const owners: Pending[] = [];
  const children: PowerPoint.Shape[] = [];
  groups.forEach((p, i) => {
    const list = lists[i];
    if (failed(list)) {
      markUnread(p.out, "group children: PowerPoint refused to read them");
      return;
    }
    for (const child of list) {
      owners.push(p);
      children.push(child);
    }
  });
  const read = await readShapeContent(context, children, support, depth + 1);
  const byOwner = new Map<Pending, PowerPointShapeOut[]>();
  read.forEach((child, i) => {
    const list = byOwner.get(owners[i]) ?? [];
    list.push(child);
    byOwner.set(owners[i], list);
  });
  for (const p of groups)
    if (!p.out.unread?.some((note) => note.startsWith("group children")))
      p.out.children = readingOrder(byOwner.get(p) ?? []);
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
        ...(title ? { title: capText(title, 1000) } : {}),
        ...(description ? { description: capText(description, 1000) } : {}),
      };
  }
  return out;
}

/**
 * Per paragraph indent level and bullet. A shape whose paragraphs are all plain top-level text
 * keeps its `text`; otherwise `paragraphs` replaces it, so the text goes once.
 */
async function readParagraphs(
  context: PowerPoint.RequestContext,
  pending: readonly Pending[],
) {
  const items = pending.flatMap((p) =>
    p.raw
      ? powerpointParagraphSpans(p.raw)
          .slice(0, MAX_PARAGRAPHS_PER_SHAPE)
          .filter((span) => span.length > 0)
          .map((span) => ({ p, span }))
      : [],
  );
  const formats = await readEach(context, items, ({ p, span }) => {
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
  const formatOf = new Map<string, (typeof formats)[number]>();
  items.forEach(({ p, span }, i) =>
    formatOf.set(`${p.out.id}:${span.start}`, formats[i]),
  );

  for (const p of pending) {
    if (!p.raw) continue;
    const spans = powerpointParagraphSpans(p.raw);
    const paragraphs: PowerPointParagraphOut[] = spans.map((span, index) => {
      const text = normalizePowerPointText(
        p.raw!.slice(span.start, span.start + span.length),
      );
      if (index >= MAX_PARAGRAPHS_PER_SHAPE) return { text };
      const format = formatOf.get(`${p.out.id}:${span.start}`);
      if (format === undefined || failed(format))
        return { text, level: TOP_INDENT_LEVEL };
      return {
        text,
        level: format.level,
        ...(format.bullet ? { bullet: format.bullet } : {}),
      };
    });
    const structured = paragraphs.some(
      (paragraph) =>
        paragraph.bullet ||
        (paragraph.level !== undefined && paragraph.level > TOP_INDENT_LEVEL),
    );
    if (!structured) continue;
    p.out.paragraphs = capParagraphs(p.out, paragraphs);
    delete p.out.text;
    if (spans.length > MAX_PARAGRAPHS_PER_SHAPE)
      markUnread(
        p.out,
        `bullet levels of paragraphs ${MAX_PARAGRAPHS_PER_SHAPE + 1}-${spans.length}: not read`,
      );
  }
}

/** The same character budget as a shape's text, spent over its paragraphs in order. */
function capParagraphs(
  out: PowerPointShapeOut,
  paragraphs: PowerPointParagraphOut[],
): PowerPointParagraphOut[] {
  let left = MAX_TEXT_CHARACTERS;
  const kept: PowerPointParagraphOut[] = [];
  for (const paragraph of paragraphs) {
    if (left <= 0) break;
    kept.push({ ...paragraph, text: capText(paragraph.text, left) });
    left -= paragraph.text.length;
  }
  if (kept.length < paragraphs.length)
    markUnread(
      out,
      `paragraphs ${kept.length + 1}-${paragraphs.length}: cut to keep the result small`,
    );
  return kept;
}

const encoder = new TextEncoder();
export const jsonBytes = (value: unknown) =>
  encoder.encode(JSON.stringify(value)).length;

/** Keeps the longest prefix of `items` whose JSON fits in `room`. */
function prefixThatFits<T>(items: readonly T[], room: number): T[] {
  const kept: T[] = [];
  let used = 2;
  for (const item of items) {
    const size = jsonBytes(item) + 1;
    if (used + size > room) break;
    kept.push(item);
    used += size;
  }
  return kept;
}

const CUT = "cut to keep the result small";
const CUT_MARK = /…\[cut: \d+ more characters\]$/;

/**
 * One shape within `maxBytes` of JSON: group children, table rows, paragraphs, then text and alt
 * text are cut in that order, each cut named in `unread`.
 */
export function capShape(
  shape: PowerPointShapeOut,
  maxBytes: number,
): PowerPointShapeOut {
  if (jsonBytes(shape) <= maxBytes) return shape;
  const out: PowerPointShapeOut = {
    ...shape,
    unread: [...(shape.unread ?? [])],
  };
  // Room for the notes this function adds.
  const budget = maxBytes - 400;
  const others = () =>
    jsonBytes({ ...out, children: [], table: undefined, paragraphs: [] });

  if (out.children) {
    const all = out.children;
    const room = budget - others();
    const kept: PowerPointShapeOut[] = [];
    let used = 2;
    for (const child of all) {
      const left = room - used;
      if (left < 300) break;
      const capped = capShape(child, left);
      const size = jsonBytes(capped) + 1;
      if (used + size > room) break;
      kept.push(capped);
      used += size;
    }
    out.children = kept;
    if (kept.length < all.length)
      out.unread!.push(
        `group children ${kept.length + 1}-${all.length} of ${all.length}: ${CUT}`,
      );
  }
  if (out.table && jsonBytes(out) > budget) {
    const rows = prefixThatFits(out.table.values, budget - others());
    if (rows.length < out.table.values.length)
      out.unread!.push(
        `table rows ${rows.length + 1}-${out.table.values.length}: ${CUT}`,
      );
    out.table = { ...out.table, values: rows };
  }
  if (out.paragraphs && jsonBytes(out) > budget) {
    const kept = prefixThatFits(out.paragraphs, budget - others());
    if (kept.length < out.paragraphs.length)
      out.unread!.push(
        `paragraphs ${kept.length + 1}-${out.paragraphs.length}: ${CUT}`,
      );
    out.paragraphs = kept;
  }
  // Characters can take up to 4 bytes, so cut by the overshoot until it fits.
  for (let pass = 0; out.text && jsonBytes(out) > budget && pass < 8; pass++) {
    const over = jsonBytes(out) - budget;
    const kept = out.text.replace(CUT_MARK, "");
    out.text = capText(
      (shape.text ?? "").replace(CUT_MARK, ""),
      Math.max(0, kept.length - Math.ceil(over / 2) - 60),
    );
  }
  if (out.altText && jsonBytes(out) > budget) {
    out.altText = {
      ...(out.altText.title ? { title: capText(out.altText.title, 200) } : {}),
      ...(out.altText.description
        ? { description: capText(out.altText.description, 200) }
        : {}),
    };
  }
  if (out.unread!.length === 0) delete out.unread;
  return out;
}
