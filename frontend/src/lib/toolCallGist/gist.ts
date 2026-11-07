import { cleanServerText, lastPointerSegment } from "./serverText";

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
  /** The array positions a wildcard pointer reached it at, to line up a batch. */
  row?: string;
}

/** Field values that make a card say more than its line. */
export type GistWarning = "workspace" | "public";

export interface GistField {
  pointer: string;
  name: string;
  values: { value: GistValue; earlier?: GistValue }[];
  omitted: number;
  warning?: GistWarning;
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

const rowOf = (pointer: string, path: string): string | undefined => {
  const segments = path.split("/");
  const keys = pointer
    .split("/")
    .flatMap((segment, index) =>
      segment === "*" ? [segments[index] ?? ""] : [],
    );
  return keys.length > 0 ? keys.join("/") : undefined;
};

const gistValue = (
  slot: ToolCallLabelSlot,
  value: ToolCallLabelValue,
  identifies: Identifies,
): GistValue => {
  const row = rowOf(slot.pointer, value.path);
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
): GistValue[] =>
  slot
    ? (slot.values ?? [])
        .filter((value) => value.text.length > 0)
        .map((value) => gistValue(slot, value, identifies))
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

const gistField = (
  slot: ToolCallLabelSlot,
  action: GistAction,
): GistField | undefined => {
  const values = (slot.values ?? [])
    .filter((value) => value.text.length > 0)
    .map((value) => ({
      value: gistValue(slot, { ...value, resolved: undefined }, "maybe"),
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
  const name =
    slot.name ?? cleanServerText(memberName(slot.pointer) ?? "").text;
  return {
    pointer: slot.pointer,
    name,
    values,
    omitted: slot.omitted ?? 0,
    warning: fieldWarningOf(
      name,
      values.map(({ value }) => value.text),
    ),
  };
};

const gistItem = (
  item: ToolCallLabelItem,
  action: GistAction,
): GistItem | undefined => {
  const titles = valuesOf(item.title, "never");
  const nameSlot = titles.length > 0 ? item.title : item.id;
  const names = titles.length > 0 ? titles : valuesOf(item.id, "always");
  const gist: GistItem = {
    names,
    count: Math.max(names.length + (nameSlot?.omitted ?? 0), 1),
    where: valuesOf(item.target, "maybe"),
    whereOmitted: item.target?.omitted ?? 0,
    before: valuesOf(item.before, "maybe"),
    after: valuesOf(item.after, "never"),
    fields: (item.fields ?? []).flatMap((slot) => {
      const field = gistField(slot, action);
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
 * label, a verb or kind this build has no words for, or a label that names
 * nothing a sentence could say.
 */
export const gistOf = (
  label: ToolCallLabel | null | undefined,
): Gist | undefined => {
  if (!label || label.source === "generic") return undefined;
  const action: string = label.action;
  const kind: string = label.object_kind;
  if (!isGistAction(action) || !isGistKind(kind)) return undefined;
  const items = (label.items ?? []).flatMap((item) => {
    const gist = gistItem(item, action);
    return gist ? [gist] : [];
  });
  const namesSomething = items.some(
    (item) => item.names.length > 0 || item.where.length > 0,
  );
  if (items.length === 0 || (kind === "other" && !namesSomething)) {
    return undefined;
  }
  return { action, kind, items };
};

/** Which card a call's display asks for. Rows saved before labels render as before. */
export type ToolCallCardKind = "gist" | "generic" | "legacy";

export const toolCallCardKind = (
  label: ToolCallLabel | null | undefined,
): ToolCallCardKind =>
  label == null ? "legacy" : gistOf(label) ? "gist" : "generic";
