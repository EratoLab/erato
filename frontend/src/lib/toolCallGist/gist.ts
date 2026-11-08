import {
  holdsConsentFlag,
  readArgumentValues,
  valueBudget,
  viewLeavesOutMembers,
  wholeValue,
} from "./argumentValues";
import { isConsentClaim, isConsentMember } from "./consent";
import {
  cleanServerText,
  countOf,
  isRecord,
  lastPointerSegment,
  MAX_SERVER_DESCRIPTION_CHARS,
  readPointer,
} from "./serverText";

import type { ArgumentTexts, ValueBudget } from "./argumentValues";
import type {
  ToolArgumentNode,
  ToolCallAction,
  ToolCallLabel,
  ToolCallLabelSource,
  ToolCallLabelWarning,
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

/* eslint-disable lingui/no-unlocalized-strings -- API enum values */
const GIST_SOURCES = [
  "own_mapping",
  "rules",
  "model",
] as const satisfies readonly ToolCallLabelSource[];

const ARGUMENTS_TRUNCATED = "arguments_truncated";
const HIDDEN_CHARACTERS = "hidden_characters";
/* eslint-enable lingui/no-unlocalized-strings */

/** The label warnings a gist card can show; any other sends a call to the generic card. */
const GIST_LABEL_WARNINGS = [
  ARGUMENTS_TRUNCATED,
  HIDDEN_CHARACTERS,
] as const satisfies readonly ToolCallLabelWarning[];

/** Before approval, after a run the server reported as done, after one it reported as failed. */
export type GistPhase = "ask" | "done" | "failed";
export const GIST_PHASES = ["ask", "done", "failed"] as const;

/**
 * Where a value comes from, which decides how it looks: text the call wrote,
 * a name an earlier result in the chat gave the value, the value a field had
 * in an earlier result, or an ID shown short.
 */
export type GistValueOrigin = "written" | "resolved" | "earlier" | "id";

export interface GistValue {
  text: string;
  origin: GistValueOrigin;
  /** Where the value sits in the call's input; empty on an earlier value. */
  path: string;
  /** The value as the call wrote it, where `text` shows a name or a short ID. */
  written?: string;
  /** Whether `written` is an ID, which a card shows short. */
  writtenId?: boolean;
  /** Whether the value as written is cut; on a name, the written value beside it. */
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
  /** Whether cleaning removed hidden characters from a value or name the label holds. */
  hiddenCharacters: boolean;
  /** Whether a key value was left out because it is a consent flag. */
  leavesOutConsent: boolean;
}

const isOneOf = <T extends string>(
  values: readonly T[],
  value: unknown,
): value is T => typeof value === "string" && values.some((v) => v === value);

// A label is read as data from a stored row or a stream event, whatever its
// type says: anything this build cannot read counts as absent.
const listOf = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];

const MAX_GIST_ITEMS = 10;
const MAX_GIST_FIELDS = 16;
const MAX_SLOT_VALUES = 50;
/** A pointer or path no backend label holds; longer ones are not read. */
const MAX_PATH_CHARS = 4_096;

interface LabelValue {
  path: string;
  text: string;
  resolved?: string;
  truncated: boolean;
  hidden: boolean;
}

interface LabelSlot {
  pointer: string;
  name?: string;
  values: LabelValue[];
  omitted: number;
  /** Whether cleaning removed hidden characters from its name or a value. */
  hidden: boolean;
}

interface LabelItem {
  title?: LabelSlot;
  id?: LabelSlot;
  target?: LabelSlot;
  before?: LabelSlot;
  after?: LabelSlot;
  fields: LabelSlot[];
}

const readValue = (raw: unknown): LabelValue | undefined => {
  if (!isRecord(raw) || typeof raw.path !== "string") return undefined;
  if (raw.path.length > MAX_PATH_CHARS) return undefined;
  const text = cleanServerText(raw.text, MAX_SERVER_DESCRIPTION_CHARS);
  if (text.text.length === 0) return undefined;
  const resolved = cleanServerText(raw.resolved);
  return {
    path: raw.path,
    text: text.text,
    resolved: resolved.text.length > 0 ? resolved.text : undefined,
    truncated: raw.truncated === true || text.truncated,
    hidden: text.hiddenCharacters || resolved.hiddenCharacters,
  };
};

/** The member a pointer names, for a pointer that ends in a wildcard too. */
const memberName = (pointer: string): string | undefined =>
  lastPointerSegment(pointer.replace(/\/\*$/, ""));

/** A field without a name of its own is called after the member it reads. */
const readSlot = (raw: unknown, field = false): LabelSlot | undefined => {
  if (!isRecord(raw) || typeof raw.pointer !== "string") return undefined;
  if (raw.pointer.length > MAX_PATH_CHARS) return undefined;
  const all = listOf(raw.values);
  const kept = all.slice(0, MAX_SLOT_VALUES);
  const given = cleanServerText(raw.name);
  const member =
    field && given.text.length === 0
      ? cleanServerText(memberName(raw.pointer))
      : undefined;
  const name = member ? member.text : given.text;
  const values = kept.flatMap((value) => {
    const read = readValue(value);
    return read ? [read] : [];
  });
  return {
    pointer: raw.pointer,
    name: name.length > 0 ? name : undefined,
    values,
    omitted: countOf(raw.omitted) + (all.length - kept.length),
    hidden:
      given.hiddenCharacters ||
      member?.hiddenCharacters === true ||
      values.some((value) => value.hidden),
  };
};

const readItem = (raw: unknown): LabelItem | undefined =>
  isRecord(raw)
    ? {
        title: readSlot(raw.title),
        id: readSlot(raw.id),
        target: readSlot(raw.target),
        before: readSlot(raw.before),
        after: readSlot(raw.after),
        fields: listOf(raw.fields)
          .slice(0, MAX_GIST_FIELDS)
          .flatMap((slot) => {
            const read = readSlot(slot, true);
            return read ? [read] : [];
          }),
      }
    : undefined;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_NAME = /(^|[_\-.])ids?$|[a-z]Ids?$/;
const SHORT_ID_CHARS = 8;

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
  slot: LabelSlot,
  value: LabelValue,
  identifies: Identifies,
  rowPrefix: readonly string[],
): GistValue => {
  const row = rowOf(slot.pointer, value.path, rowPrefix);
  const { path, truncated } = value;
  const isId =
    identifies === "always" ||
    (identifies === "maybe" && looksLikeAnId(value.text, slot.pointer));
  if (value.resolved) {
    return {
      text: value.resolved,
      origin: "resolved",
      path,
      written: value.text,
      writtenId: isId,
      truncated,
      row,
    };
  }
  if (isId) {
    return {
      text: shortId(value.text),
      origin: "id",
      path,
      written: value.text,
      truncated,
      row,
    };
  }
  return { text: value.text, origin: "written", path, truncated, row };
};

const valuesOf = (
  slot: LabelSlot | undefined,
  identifies: Identifies,
  rowPrefix: readonly string[],
): GistValue[] =>
  slot
    ? slot.values.map((value) => gistValue(slot, value, identifies, rowPrefix))
    : [];

const claimsConsent = (slot: LabelSlot | undefined): boolean =>
  slot !== undefined &&
  (isConsentMember(slot.name ?? "") ||
    isConsentClaim(slot.pointer) ||
    slot.values.some((value) => isConsentClaim(value.path)));

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
/** Values read for warnings, as many as the backend rules search. */
const MAX_WARNING_VALUES = 5_000;

// A label keeps only a few fields, so a sharing member past them, or beside a
// nested title, is found in the raw input.
const addInputWarnings = (input: unknown, warnings: Set<GistWarning>) => {
  let budget = MAX_WARNING_VALUES;
  const visit = (value: unknown, depth: number) => {
    if (depth > MAX_WARNING_DEPTH) return;
    const visitMember = (name: string, member: unknown) => {
      budget -= 1;
      if (typeof member === "string") {
        const warning = fieldWarningOf(name, [member]);
        if (warning) warnings.add(warning);
      } else {
        visit(member, depth + 1);
      }
    };
    if (Array.isArray(value)) {
      for (const element of value) {
        if (budget <= 0) return;
        visitMember("", element);
      }
    } else if (isRecord(value)) {
      for (const name in value) {
        if (budget <= 0) return;
        if (Object.hasOwn(value, name)) visitMember(name, value[name]);
      }
    }
  };
  visit(input, 0);
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
  addInputWarnings(input, warnings);
  return [...warnings];
};

// Defense in depth: the backend rules leave consent flags out of a label's
// fields, and a field that claims one anyway is dropped here too.
const gistField = (
  slot: LabelSlot,
  action: GistAction,
  rowPrefix: readonly string[],
): GistField | undefined => {
  if (claimsConsent(slot)) return undefined;
  const values = slot.values.map((value) => ({
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
            origin: "earlier" as const,
            path: "",
            truncated: false,
          }
        : undefined,
  }));
  if (values.length === 0) return undefined;
  return {
    pointer: slot.pointer,
    name: slot.name ?? "",
    values,
    omitted: slot.omitted,
  };
};

const gistItem = (
  item: LabelItem,
  action: GistAction,
): GistItem | undefined => {
  const hasTitle = (item.title?.values.length ?? 0) > 0;
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
    fields: item.fields.flatMap((slot) => {
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
 * label, a source, verb, kind or warning this build has no words for, a
 * label that does not say which record a change is to, or one whose line
 * would show a consent flag.
 */
export const gistOf = (
  label: ToolCallLabel | null | undefined,
  input: unknown,
): Gist | undefined => {
  const raw: unknown = label;
  if (!isRecord(raw) || !isOneOf(GIST_SOURCES, raw.source)) return undefined;
  if (raw.warnings != null && !Array.isArray(raw.warnings)) return undefined;
  if (!listOf(raw.warnings).every((w) => isOneOf(GIST_LABEL_WARNINGS, w))) {
    return undefined;
  }
  const { action, object_kind: kind } = raw;
  if (!isOneOf(GIST_ACTIONS, action) || !isOneOf(GIST_KINDS, kind)) {
    return undefined;
  }
  const labelItems = listOf(raw.items)
    .slice(0, MAX_GIST_ITEMS)
    .flatMap((item) => {
      const read = readItem(item);
      return read ? [read] : [];
    });
  const showsConsent = labelItems.some((item) =>
    [item.title, item.id, item.target, item.before, item.after].some(
      claimsConsent,
    ),
  );
  if (showsConsent) return undefined;
  const hiddenCharacters = labelItems.some((item) =>
    [
      item.title,
      item.id,
      item.target,
      item.before,
      item.after,
      ...item.fields,
    ].some((slot) => slot?.hidden === true),
  );
  const leavesOutConsent = labelItems.some((item) =>
    item.fields.some(claimsConsent),
  );
  const items = labelItems.flatMap((item) => {
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
  return {
    action,
    kind,
    items,
    warnings: gistWarningsOf(items, input),
    hiddenCharacters,
    leavesOutConsent,
  };
};

/** Values a line or a value cell shows before it counts the rest. */
export const MAX_LISTED_VALUES = 3;

export const listedValues = <T>(values: readonly T[]): T[] =>
  values.slice(0, MAX_LISTED_VALUES);

/** Whether an item's line names its one thing; a batch is counted instead. */
export const namesInLine = (item: GistItem): boolean =>
  item.count === 1 && item.names.length > 0;

export interface GistBatchRow {
  name: GistValue;
  fields: GistField[];
}

/**
 * How the values under an item's line are laid out: a batch's things one per
 * row with the fields read at each one's position, and the fields read once.
 */
export const gistItemLayout = (
  item: GistItem,
): { rows: GistBatchRow[] | undefined; shared: GistField[] } => {
  const isBatch =
    item.count > 1 && item.names.some((name) => name.row !== undefined);
  if (!isBatch) return { rows: undefined, shared: item.fields };
  const rowed = item.fields.filter((field) =>
    field.values.some(({ value }) => value.row !== undefined),
  );
  return {
    rows: item.names.map((name) => ({
      name,
      fields: rowed.flatMap((field) => {
        const values = field.values.filter(
          ({ value }) => value.row === name.row,
        );
        return values.length > 0 ? [{ ...field, values, omitted: 0 }] : [];
      }),
    })),
    shared: item.fields.filter((field) => !rowed.includes(field)),
  };
};

/** Whether an item's line, in the language shown, names its title and its destination. */
export type GistLineSlots = (
  gist: Gist,
  item: GistItem,
) => { title: boolean; where: boolean };

const sentenceSlots: GistLineSlots = (_gist, item) => ({
  title: namesInLine(item),
  where: true,
});

/**
 * Where the values a gist card shows sit in the call's input, and whether
 * each is shown whole. Mirrors what `ToolCallGist` renders in the ask phase,
 * where a name shows the value written beside it and an ID shows whole.
 */
export const gistShownPaths = (
  gist: Gist,
  lineSlots: GistLineSlots = sentenceSlots,
): Map<string, boolean> => {
  const shown = new Map<string, boolean>();
  const add = (values: readonly GistValue[]) => {
    for (const value of values) {
      shown.set(value.path, shown.get(value.path) === true || !value.truncated);
    }
  };
  const addFields = (fields: readonly GistField[]) => {
    for (const field of fields) {
      add(listedValues(field.values).map(({ value }) => value));
    }
  };
  for (const item of gist.items) {
    const line = lineSlots(gist, item);
    if (line.title && namesInLine(item)) add(listedValues(item.names));
    if (line.where) add(listedValues(item.where));
    add(item.before);
    add(item.after);
    const { rows, shared } = gistItemLayout(item);
    for (const row of rows ?? []) {
      add([row.name]);
      addFields(row.fields);
    }
    addFields(shared);
  }
  return shown;
};

const MAX_VIEW_DEPTH = 16;
const MAX_VIEW_NODES = 1_000;

const isBranch = (node: ToolArgumentNode) =>
  node.kind === "group" || node.kind === "list";

/**
 * A readable view of the arguments as this build can render it: nodes it
 * cannot read, or past its caps, are counted as omitted.
 */
export const readArgumentView = (
  raw: unknown,
): ToolArgumentNode | undefined => {
  let budget = MAX_VIEW_NODES;
  const read = (node: unknown, depth: number): ToolArgumentNode | undefined => {
    if (budget <= 0) return undefined;
    budget -= 1;
    if (!isRecord(node)) return undefined;
    const { path, kind } = node;
    if (typeof path !== "string" || path.length > MAX_PATH_CHARS) {
      return undefined;
    }
    if (typeof kind !== "string") return undefined;
    const all = listOf(node.children);
    const children: ToolArgumentNode[] = [];
    for (const child of depth < MAX_VIEW_DEPTH ? all : []) {
      if (budget <= 0) break;
      const kept = read(child, depth + 1);
      if (kept) children.push(kept);
    }
    return {
      path,
      kind: kind as ToolArgumentNode["kind"],
      children,
      omitted: countOf(node.omitted) + (all.length - children.length),
    };
  };
  return read(raw, 0);
};

export const hasOmittedArguments = (node: ToolArgumentNode): boolean =>
  (node.omitted ?? 0) > 0 || (node.children ?? []).some(hasOmittedArguments);

const isCovered = (
  shown: ReadonlyMap<string, boolean>,
  node: ToolArgumentNode,
): boolean => {
  if (shown.get(node.path) === true) return true;
  for (
    let end = node.path.lastIndexOf("/");
    end >= 0;
    end = end === 0 ? -1 : node.path.lastIndexOf("/", end - 1)
  ) {
    if (shown.get(node.path.slice(0, end)) === true) return true;
  }
  return false;
};

/**
 * The part of the readable view a gist card does not show: every argument
 * with no value on the card, or only a cut one, so the card never hides one.
 * Consent flags stay out, as on the generic card, and the card says so; the
 * raw arguments still have them.
 */
export const unshownArguments = (
  view: ToolArgumentNode,
  gist: Gist,
  lineSlots?: GistLineSlots,
): { view: ToolArgumentNode | undefined; leavesOutConsent: boolean } => {
  const shown = gistShownPaths(gist, lineSlots);
  let leavesOutConsent = false;
  const prune = (node: ToolArgumentNode): ToolArgumentNode | undefined => {
    if (isCovered(shown, node)) return undefined;
    if (isConsentClaim(node.path)) {
      leavesOutConsent = true;
      return undefined;
    }
    if (!isBranch(node)) return node;
    const children = (node.children ?? []).flatMap((child) => {
      const kept = prune(child);
      return kept ? [kept] : [];
    });
    return children.length > 0 || (node.omitted ?? 0) > 0
      ? { ...node, children }
      : undefined;
  };
  return { view: prune(view), leavesOutConsent };
};

/**
 * The gist with the text it writes read whole from the call's input, so an
 * approval card shows past the label's cut what the call writes.
 */
const withWholeText = (
  gist: Gist,
  input: unknown,
  budget: ValueBudget,
): { gist: Gist; hiddenCharacters: boolean } => {
  let hiddenCharacters = false;
  const whole = (value: GistValue): GistValue => {
    if (value.origin !== "written") return value;
    const raw = readPointer(input, value.path);
    if (typeof raw !== "string") return value;
    const cleaned = wholeValue(raw, budget);
    if (cleaned.text.length === 0) return value;
    hiddenCharacters ||= cleaned.hiddenCharacters;
    return { ...value, text: cleaned.text, truncated: cleaned.truncated };
  };
  return {
    gist: {
      ...gist,
      items: gist.items.map((item) => ({
        ...item,
        before: item.before.map(whole),
        after: item.after.map(whole),
      })),
    },
    hiddenCharacters,
  };
};

/**
 * What a gist card lists below its line: the arguments it does not show, with
 * their values whole, or, for a label without a readable view, the raw
 * arguments.
 */
export type GistRest =
  | {
      kind: "view";
      view: ToolArgumentNode | undefined;
      values: ArgumentTexts;
      truncated: boolean;
    }
  | { kind: "raw" };

/** What a labelled approval card says under its arguments. */
export interface ToolCallCardNotes {
  /** A value or name the card shows lost hidden characters. */
  hiddenCharacters: boolean;
  /** The card leaves out a consent flag the call set itself. */
  leavesOutConsent: boolean;
}

/** Which card a call gets. Rows saved before labels render as before. */
export type ToolCallCard =
  | { kind: "gist"; gist: Gist; rest: GistRest; notes: ToolCallCardNotes }
  | {
      kind: "generic";
      label: ToolCallLabel;
      view: ToolArgumentNode | undefined;
      values: ArgumentTexts;
      truncated: boolean;
      notes: ToolCallCardNotes;
    }
  | { kind: "legacy" };

const labelWarns = (label: ToolCallLabel, warning: ToolCallLabelWarning) =>
  listOf(label.warnings).includes(warning);

/**
 * The approval card for a call's label. A label this build cannot read at
 * all gets the card of a row saved before labels, never an error.
 * `lineSlots` says which values the line names in the language shown.
 */
export const toolCallCardOf = (
  label: ToolCallLabel | null | undefined,
  input: unknown,
  lineSlots?: GistLineSlots,
): ToolCallCard => {
  if (!isRecord(label)) return { kind: "legacy" };
  try {
    const budget = valueBudget();
    const view = readArgumentView(label.arguments);
    const labelTruncated = labelWarns(label, ARGUMENTS_TRUNCATED);
    const labelHidden = labelWarns(label, HIDDEN_CHARACTERS);
    const membersLeftOut =
      view !== undefined && viewLeavesOutMembers(view, input);
    const labelled = gistOf(label, input);
    if (!labelled) {
      const values = readArgumentValues(view, input, budget);
      return {
        kind: "generic",
        label,
        view,
        values: values.texts,
        truncated:
          labelTruncated ||
          (view !== undefined && hasOmittedArguments(view)) ||
          values.cut,
        notes: {
          hiddenCharacters: labelHidden || values.hiddenCharacters,
          leavesOutConsent:
            view !== undefined && (holdsConsentFlag(view) || membersLeftOut),
        },
      };
    }
    const whole = withWholeText(labelled, input, budget);
    const { gist } = whole;
    const gistHidden =
      labelHidden || gist.hiddenCharacters || whole.hiddenCharacters;
    if (!view) {
      return {
        kind: "gist",
        gist,
        rest: { kind: "raw" },
        notes: { hiddenCharacters: gistHidden, leavesOutConsent: false },
      };
    }
    const rest = unshownArguments(view, gist, lineSlots);
    const values = readArgumentValues(rest.view, input, budget);
    return {
      kind: "gist",
      gist,
      rest: {
        kind: "view",
        view: rest.view,
        values: values.texts,
        truncated:
          labelTruncated ||
          (rest.view !== undefined && hasOmittedArguments(rest.view)) ||
          values.cut,
      },
      notes: {
        hiddenCharacters: gistHidden || values.hiddenCharacters,
        leavesOutConsent:
          rest.leavesOutConsent || gist.leavesOutConsent || membersLeftOut,
      },
    };
  } catch {
    return { kind: "legacy" };
  }
};
