import { plural, select, t } from "@lingui/core/macro";

import { listedValues, namesInLine } from "./gist";

import type {
  Gist,
  GistAction,
  GistItem,
  GistLineSlots,
  GistKind,
  GistPhase,
  GistValue,
  GistWarning,
} from "./gist";

/**
 * The words of a tool-call gist: one whole sentence per verb and phase, so a
 * language can order the verb, the kind, the title and the destination its
 * own way. Kept under `lib/` so the component registry does not put it on the
 * kit surface.
 */

/** Which parts a sentence has: a title, a destination, both or neither. */
export type GistShape = "full" | "titled" | "placed" | "other";
export const GIST_SHAPES = ["full", "titled", "placed", "other"] as const;

export const gistShape = (hasTitle: boolean, hasWhere: boolean): GistShape =>
  hasTitle ? (hasWhere ? "full" : "titled") : hasWhere ? "placed" : "other";

/** The kind as a noun; more than one reads as a count, e.g. "3 rows". */
export const gistKindLabel = (kind: GistKind, count: number): string => {
  switch (kind) {
    case "page":
      return t({
        id: "toolGist.kind.page",
        message: plural(count, { one: "page", other: "# pages" }),
      });
    case "row":
      return t({
        id: "toolGist.kind.row",
        message: plural(count, { one: "row", other: "# rows" }),
      });
    case "database":
      return t({
        id: "toolGist.kind.database",
        message: plural(count, { one: "database", other: "# databases" }),
      });
    case "folder":
      return t({
        id: "toolGist.kind.folder",
        message: plural(count, { one: "folder", other: "# folders" }),
      });
    case "note":
      return t({
        id: "toolGist.kind.note",
        message: plural(count, { one: "note", other: "# notes" }),
      });
    case "comment":
      return t({
        id: "toolGist.kind.comment",
        message: plural(count, { one: "comment", other: "# comments" }),
      });
    case "paragraph":
      return t({
        id: "toolGist.kind.paragraph",
        message: plural(count, { one: "paragraph", other: "# paragraphs" }),
      });
    case "document":
      return t({
        id: "toolGist.kind.document",
        message: plural(count, { one: "document", other: "# documents" }),
      });
    case "email":
      return t({
        id: "toolGist.kind.email",
        message: plural(count, { one: "email", other: "# emails" }),
      });
    case "message":
      return t({
        id: "toolGist.kind.message",
        message: plural(count, { one: "message", other: "# messages" }),
      });
    case "event":
      return t({
        id: "toolGist.kind.event",
        message: plural(count, { one: "event", other: "# events" }),
      });
    case "file":
      return t({
        id: "toolGist.kind.file",
        message: plural(count, { one: "file", other: "# files" }),
      });
    case "task":
      return t({
        id: "toolGist.kind.task",
        message: plural(count, { one: "task", other: "# tasks" }),
      });
    case "other":
      return t({
        id: "toolGist.kind.other",
        message: plural(count, { one: "item", other: "# items" }),
      });
  }
};

export interface GistSentenceParts {
  action: GistAction;
  phase: GistPhase;
  shape: GistShape;
  kind: string;
  title: string;
  where: string;
}

/** The line a card or a trace row reads for one item. */
export const gistSentence = ({
  action,
  phase,
  shape,
  kind,
  title,
  where,
}: GistSentenceParts): string => {
  const key: `${GistAction}.${GistPhase}` = `${action}.${phase}`;
  switch (key) {
    case "create.ask":
      return t({
        id: "toolGist.create.ask",
        message: select(shape, {
          full: `Create ${kind} ${title} in ${where}`,
          titled: `Create ${kind} ${title}`,
          placed: `Create ${kind} in ${where}`,
          other: `Create ${kind}`,
        }),
      });
    case "create.done":
      return t({
        id: "toolGist.create.done",
        message: select(shape, {
          full: `Created ${kind} ${title} in ${where}`,
          titled: `Created ${kind} ${title}`,
          placed: `Created ${kind} in ${where}`,
          other: `Created ${kind}`,
        }),
      });
    case "create.failed":
      return t({
        id: "toolGist.create.failed",
        message: select(shape, {
          full: `Could not create ${kind} ${title} in ${where}`,
          titled: `Could not create ${kind} ${title}`,
          placed: `Could not create ${kind} in ${where}`,
          other: `Could not create ${kind}`,
        }),
      });
    case "update.ask":
      return t({
        id: "toolGist.update.ask",
        message: select(shape, {
          full: `Update ${kind} ${title} in ${where}`,
          titled: `Update ${kind} ${title}`,
          placed: `Update ${kind} in ${where}`,
          other: `Update ${kind}`,
        }),
      });
    case "update.done":
      return t({
        id: "toolGist.update.done",
        message: select(shape, {
          full: `Updated ${kind} ${title} in ${where}`,
          titled: `Updated ${kind} ${title}`,
          placed: `Updated ${kind} in ${where}`,
          other: `Updated ${kind}`,
        }),
      });
    case "update.failed":
      return t({
        id: "toolGist.update.failed",
        message: select(shape, {
          full: `Could not update ${kind} ${title} in ${where}`,
          titled: `Could not update ${kind} ${title}`,
          placed: `Could not update ${kind} in ${where}`,
          other: `Could not update ${kind}`,
        }),
      });
    case "delete.ask":
      return t({
        id: "toolGist.delete.ask",
        message: select(shape, {
          full: `Delete ${kind} ${title} from ${where}`,
          titled: `Delete ${kind} ${title}`,
          placed: `Delete ${kind} from ${where}`,
          other: `Delete ${kind}`,
        }),
      });
    case "delete.done":
      return t({
        id: "toolGist.delete.done",
        message: select(shape, {
          full: `Deleted ${kind} ${title} from ${where}`,
          titled: `Deleted ${kind} ${title}`,
          placed: `Deleted ${kind} from ${where}`,
          other: `Deleted ${kind}`,
        }),
      });
    case "delete.failed":
      return t({
        id: "toolGist.delete.failed",
        message: select(shape, {
          full: `Could not delete ${kind} ${title} from ${where}`,
          titled: `Could not delete ${kind} ${title}`,
          placed: `Could not delete ${kind} from ${where}`,
          other: `Could not delete ${kind}`,
        }),
      });
    case "move.ask":
      return t({
        id: "toolGist.move.ask",
        message: select(shape, {
          full: `Move ${kind} ${title} to ${where}`,
          titled: `Move ${kind} ${title}`,
          placed: `Move ${kind} to ${where}`,
          other: `Move ${kind}`,
        }),
      });
    case "move.done":
      return t({
        id: "toolGist.move.done",
        message: select(shape, {
          full: `Moved ${kind} ${title} to ${where}`,
          titled: `Moved ${kind} ${title}`,
          placed: `Moved ${kind} to ${where}`,
          other: `Moved ${kind}`,
        }),
      });
    case "move.failed":
      return t({
        id: "toolGist.move.failed",
        message: select(shape, {
          full: `Could not move ${kind} ${title} to ${where}`,
          titled: `Could not move ${kind} ${title}`,
          placed: `Could not move ${kind} to ${where}`,
          other: `Could not move ${kind}`,
        }),
      });
    case "send.ask":
      return t({
        id: "toolGist.send.ask",
        message: select(shape, {
          full: `Send ${kind} ${title} to ${where}`,
          titled: `Send ${kind} ${title}`,
          placed: `Send ${kind} to ${where}`,
          other: `Send ${kind}`,
        }),
      });
    case "send.done":
      return t({
        id: "toolGist.send.done",
        message: select(shape, {
          full: `Sent ${kind} ${title} to ${where}`,
          titled: `Sent ${kind} ${title}`,
          placed: `Sent ${kind} to ${where}`,
          other: `Sent ${kind}`,
        }),
      });
    case "send.failed":
      return t({
        id: "toolGist.send.failed",
        message: select(shape, {
          full: `Could not send ${kind} ${title} to ${where}`,
          titled: `Could not send ${kind} ${title}`,
          placed: `Could not send ${kind} to ${where}`,
          other: `Could not send ${kind}`,
        }),
      });
    case "comment.ask":
      return t({
        id: "toolGist.comment.ask",
        message: select(shape, {
          full: `Comment on ${kind} ${title} in ${where}`,
          titled: `Comment on ${kind} ${title}`,
          placed: `Comment on ${kind} in ${where}`,
          other: `Comment on ${kind}`,
        }),
      });
    case "comment.done":
      return t({
        id: "toolGist.comment.done",
        message: select(shape, {
          full: `Commented on ${kind} ${title} in ${where}`,
          titled: `Commented on ${kind} ${title}`,
          placed: `Commented on ${kind} in ${where}`,
          other: `Commented on ${kind}`,
        }),
      });
    case "comment.failed":
      return t({
        id: "toolGist.comment.failed",
        message: select(shape, {
          full: `Could not comment on ${kind} ${title} in ${where}`,
          titled: `Could not comment on ${kind} ${title}`,
          placed: `Could not comment on ${kind} in ${where}`,
          other: `Could not comment on ${kind}`,
        }),
      });
  }
};

export const gistWarningLabel = (warning: GistWarning): string => {
  switch (warning) {
    case "workspace":
      return t({
        id: "toolGist.warning.sharedWithWorkspace",
        message: "Shared with your workspace: everyone in it can see this.",
      });
    case "public":
      return t({
        id: "toolGist.warning.public",
        message: "Public: anyone can see this.",
      });
  }
};

// Private-use characters never occur in a catalog, so a sentence built with
// them can be split where a component renders the values.
export const GIST_TITLE_SLOT = "\uE000";
export const GIST_WHERE_SLOT = "\uE001";
export const GIST_SLOTS = /([\uE000\uE001])/;

/** One item's line with the slots still in it. */
export const gistLineSentence = (
  gist: Gist,
  item: GistItem,
  phase: GistPhase,
): string =>
  gistSentence({
    action: gist.action,
    phase,
    // A batch is counted in the line and named in its rows.
    shape: gistShape(namesInLine(item), item.where.length > 0),
    kind: gistKindLabel(gist.kind, item.count),
    title: GIST_TITLE_SLOT,
    where: GIST_WHERE_SLOT,
  });

const plainValues = (values: GistValue[]) =>
  listedValues(values)
    .map((value) =>
      value.origin === "written" ? `“${value.text}”` : value.text,
    )
    .join(", ");

/**
 * Which values an approval card's line names in the language shown, so a
 * translation that leaves one out does not hide it.
 */
export const gistAskLineSlots: GistLineSlots = (gist, item) => {
  const sentence = gistLineSentence(gist, item, "ask");
  return {
    title: sentence.includes(GIST_TITLE_SLOT),
    where: sentence.includes(GIST_WHERE_SLOT),
  };
};

/** The line as plain text, for a tooltip on a row that truncates it. */
export const gistPlainLine = (
  gist: Gist,
  item: GistItem,
  phase: GistPhase,
): string =>
  gistLineSentence(gist, item, phase)
    .split(GIST_SLOTS)
    .map((part) =>
      part === GIST_TITLE_SLOT
        ? plainValues(item.names)
        : part === GIST_WHERE_SLOT
          ? plainValues(item.where)
          : part,
    )
    .join("");
