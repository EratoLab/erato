import { cleanServerText, isRecord, lastPointerSegment } from "./serverText";

import type {
  ToolCallAction,
  ToolCallLabel,
  ToolCallLabelItem,
  ToolCallLabelSlot,
  ToolCallLabelValue,
  ToolCallObjectKind,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/** The verbs a gist has sentences for. `other` and unknown verbs get the generic card. */
export const GIST_ACTIONS = [
  "create",
  "update",
  "delete",
  "move",
  "send",
  "comment",
] as const satisfies readonly ToolCallAction[];
export type GistAction = (typeof GIST_ACTIONS)[number];

export const GIST_KINDS = [
  "page",
  "row",
  "database",
  "folder",
  "note",
  "comment",
  "paragraph",
  "document",
  "email",
  "message",
  "event",
  "file",
  "task",
  "other",
] as const satisfies readonly ToolCallObjectKind[];
export type GistKind = (typeof GIST_KINDS)[number];

/** Before approval, after a run the server reported as done, after one it reported as failed. */
export type GistPhase = "ask" | "done" | "failed";
export const GIST_PHASES = ["ask", "done", "failed"] as const;

/**
 * Where a value comes from, which decides how it looks: text the call wrote,
 * a name an earlier result in the chat gave the value, or an ID shown short.
 */
export type GistValueOrigin = "written" | "resolved" | "id";

export interface GistValue {
  text: string;
  origin: GistValueOrigin;
  /** The value as the call wrote it, where `text` shows a name or a short ID. */
  written?: string;
  truncated: boolean;
  /** The positions in the name's arrays it was reached at, to line up a batch. */
  row?: string;
}

/** Field values that make a card say more than its line. */
export type GistWarning = "workspace" | "public";

export interface GistField {
  pointer: string;
  name: string;
  values: { value: GistValue; earlier?: GistValue }[];
  omitted: number;
}

export interface GistItem {
  /** What the line calls the thing: its title, else its ID. */
  names: GistValue[];
  /** How many things the item acts on, counting values the label left out. */
  count: number;
  where: GistValue[];
  whereOmitted: number;
  before: GistValue[];
  after: GistValue[];
  fields: GistField[];
}

export interface Gist {
  action: GistAction;
  kind: GistKind;
  items: GistItem[];
  warnings: GistWarning[];
}

const isGistAction = (value: string): value is GistAction =>
  (GIST_ACTIONS as readonly string[]).includes(value);

const isGistKind = (value: string): value is GistKind =>
  (GIST_KINDS as readonly string[]).includes(value);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_NAME = /(^|[_\-.])ids?$|[a-z]Ids?$/;
const SHORT_ID_CHARS = 8;

/** The member a pointer names, for a pointer that ends in a wildcard too. */
const memberName = (pointer: string): string | undefined =>
  lastPointerSegment(pointer.replace(/\/\*$/, ""));

/** Whether a value the call wrote reads as an identifier rather than a name. */
const looksLikeAnId = (text: string, pointer: string): boolean => {
  if (text.length === 0 || /\s/.test(text)) return false;
  if (UUID.test(text)) return true;
  const name = memberName(pointer);
  return name !== undefined && ID_NAME.test(name);
};

/** Whether a slot's values identify records: always, when they look like IDs, or never. */
type Identifies = "always" | "maybe" | "never";

export const shortId = (text: string): string => {
  const chars = Array.from(text);
  return chars.length > SHORT_ID_CHARS + 4
    ? `${chars.slice(0, SHORT_ID_CHARS).join("")}…`
    : text;
};

/** The name slot's pointer up to its last wildcard: the arrays a batch's rows are in. */
const rowPrefixOf = (pointer: string | undefined): string[] => {
  const segments = pointer?.split("/") ?? [];
  return segments.slice(0, segments.lastIndexOf("*") + 1);
};

// A value lines up with a name only under all of the name's arrays: an index
// into another array, or into the outer one alone, counts something else.
const rowOf = (
  pointer: string,
  path: string,
  rowPrefix: readonly string[],
): string | undefined => {
  if (rowPrefix.length === 0) return undefined;
  const segments = pointer.split("/");
  if (rowPrefix.some((segment, index) => segments[index] !== segment)) {
    return undefined;
  }
  const keys = path.split("/");
  return rowPrefix
    .flatMap((segment, index) => (segment === "*" ? [keys[index] ?? ""] : []))
    .join("/");
};

const gistValue = (
  slot: ToolCallLabelSlot,
  value: ToolCallLabelValue,
  identifies: Identifies,
  rowPrefix: readonly string[],
): GistValue => {
  const row = rowOf(slot.pointer, value.path, rowPrefix);
  const truncated = value.truncated === true;
  if (value.resolved) {
    return {
      text: value.resolved,
      origin: "resolved",
      written: value.text,
      truncated: false,
      row,
    };
  }
  if (
    identifies === "always" ||
    (identifies === "maybe" && looksLikeAnId(value.text, slot.pointer))
  ) {
    return {
      text: shortId(value.text),
      origin: "id",
      written: value.text,
      truncated,
      row,
    };
  }
  return { text: value.text, origin: "written", truncated, row };
};

const valuesOf = (
  slot: ToolCallLabelSlot | undefined,
  identifies: Identifies,
  rowPrefix: readonly string[],
): GistValue[] =>
  slot
    ? (slot.values ?? [])
        .filter((value) => value.text.length > 0)
        .map((value) => gistValue(slot, value, identifies, rowPrefix))
    : [];

const WORKSPACE_VALUES = new Set([
  "workspace",
  "organization",
  "organisation",
  "org",
  "team",
  "company",
]);
const PUBLIC_VALUES = new Set(["public", "anyone", "everyone"]);

/**
 * A warning the card shows for a known field: a rule on the value the call
 * writes, never on what the label or the server claims.
 */
export const fieldWarningOf = (
  name: string,
  values: readonly string[],
): GistWarning | undefined => {
  const field = name.toLowerCase();
  if (field !== "visibility" && field !== "sharing") return undefined;
  const written = values.map((value) => value.trim().toLowerCase());
  if (written.some((value) => PUBLIC_VALUES.has(value))) return "public";
  if (written.some((value) => WORKSPACE_VALUES.has(value))) {
    return "workspace";
  }
  return undefined;
};

const MAX_WARNING_DEPTH = 6;

// A label keeps only a few fields, so a sharing member past them, or beside a
// nested title, is found in the raw input.
const addInputWarnings = (
  value: unknown,
  depth: number,
  warnings: Set<GistWarning>,
) => {
  if (depth > MAX_WARNING_DEPTH) return;
  const members = Array.isArray(value)
    ? value.map((element) => ["", element] as const)
    : isRecord(value)
      ? Object.entries(value)
      : [];
  for (const [name, member] of members) {
    if (typeof member === "string") {
      const warning = fieldWarningOf(name, [member]);
      if (warning) warnings.add(warning);
    } else {
      addInputWarnings(member, depth + 1, warnings);
    }
  }
};

const gistWarningsOf = (items: GistItem[], input: unknown): GistWarning[] => {
  const warnings = new Set<GistWarning>();
  for (const field of items.flatMap((item) => item.fields)) {
    const warning = fieldWarningOf(
      field.name,
      field.values.map(({ value }) => value.written ?? value.text),
    );
    if (warning) warnings.add(warning);
  }
  addInputWarnings(input, 0, warnings);
  return [...warnings];
};

const gistField = (
  slot: ToolCallLabelSlot,
  action: GistAction,
  rowPrefix: readonly string[],
): GistField | undefined => {
  const values = (slot.values ?? [])
    .filter((value) => value.text.length > 0)
    .map((value) => ({
      value: gistValue(
        slot,
        { ...value, resolved: undefined },
        "maybe",
        rowPrefix,
      ),
      earlier:
        action === "update" && value.resolved
          ? {
              text: value.resolved,
              origin: "resolved" as const,
              truncated: false,
            }
          : undefined,
    }));
  if (values.length === 0) return undefined;
  return {
    pointer: slot.pointer,
    name: slot.name ?? cleanServerText(memberName(slot.pointer) ?? "").text,
    values,
    omitted: slot.omitted ?? 0,
  };
};

const gistItem = (
  item: ToolCallLabelItem,
  action: GistAction,
): GistItem | undefined => {
  const hasTitle = (item.title?.values ?? []).some(
    (value) => value.text.length > 0,
  );
  const nameSlot = hasTitle ? item.title : item.id;
  const rowPrefix = rowPrefixOf(nameSlot?.pointer);
  const names = valuesOf(nameSlot, hasTitle ? "never" : "always", rowPrefix);
  const gist: GistItem = {
    names,
    count: Math.max(names.length + (nameSlot?.omitted ?? 0), 1),
    where: valuesOf(item.target, "maybe", rowPrefix),
    whereOmitted: item.target?.omitted ?? 0,
    before: valuesOf(item.before, "maybe", rowPrefix),
    after: valuesOf(item.after, "never", rowPrefix),
    fields: (item.fields ?? []).flatMap((slot) => {
      const field = gistField(slot, action, rowPrefix);
      return field ? [field] : [];
    }),
  };
  const saysAnything =
    gist.names.length > 0 ||
    gist.where.length > 0 ||
    gist.before.length > 0 ||
    gist.after.length > 0 ||
    gist.fields.length > 0;
  return saysAnything ? gist : undefined;
};

/**
 * The gist a label gives, or `undefined` for the generic card: a generic
 * label, a verb, kind or warning this build has no words for, or a label
 * that does not say which record a change is to.
 */
export const gistOf = (
  label: ToolCallLabel | null | undefined,
  input: unknown,
): Gist | undefined => {
  if (!label || label.source === "generic") return undefined;
  if (label.warnings?.includes("other")) return undefined;
  const action: string = label.action;
  const kind: string = label.object_kind;
  if (!isGistAction(action) || !isGistKind(kind)) return undefined;
  const items = (label.items ?? []).flatMap((item) => {
    const gist = gistItem(item, action);
    return gist ? [gist] : [];
  });
  // Only something new can be told apart by its values alone.
  const needsName =
    kind === "other" || (action !== "create" && action !== "send");
  const namesSomething = items.some(
    (item) => item.names.length > 0 || item.where.length > 0,
  );
  if (items.length === 0 || (needsName && !namesSomething)) return undefined;
  return { action, kind, items, warnings: gistWarningsOf(items, input) };
};

/** Which card a call gets. Rows saved before labels render as before. */
export type ToolCallCard =
  | { kind: "gist"; gist: Gist }
  | { kind: "generic"; label: ToolCallLabel }
  | { kind: "legacy" };

export const toolCallCardOf = (
  label: ToolCallLabel | null | undefined,
  input: unknown,
): ToolCallCard => {
  if (label == null) return { kind: "legacy" };
  const gist = gistOf(label, input);
  return gist ? { kind: "gist", gist } : { kind: "generic", label };
};
