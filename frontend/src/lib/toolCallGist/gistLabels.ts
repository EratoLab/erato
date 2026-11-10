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
import type { ToolCallOpaqueKind } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

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

/**
 * The kind of one of a table's records, the table read as part of the kind
 * and never as where the record lives: "account row", "3 account rows".
 */
const tableKindLabel = (kind: GistKind, count: number, table: string): string =>
  t({
    id: "toolGist.kind.ofTable",
    message: select(kind, {
      page: plural(count, {
        one: `${table} page`,
        other: `# ${table} pages`,
      }),
      database: plural(count, {
        one: `${table} database`,
        other: `# ${table} databases`,
      }),
      folder: plural(count, {
        one: `${table} folder`,
        other: `# ${table} folders`,
      }),
      note: plural(count, {
        one: `${table} note`,
        other: `# ${table} notes`,
      }),
      comment: plural(count, {
        one: `${table} comment`,
        other: `# ${table} comments`,
      }),
      paragraph: plural(count, {
        one: `${table} paragraph`,
        other: `# ${table} paragraphs`,
      }),
      document: plural(count, {
        one: `${table} document`,
        other: `# ${table} documents`,
      }),
      email: plural(count, {
        one: `${table} email`,
        other: `# ${table} emails`,
      }),
      message: plural(count, {
        one: `${table} message`,
        other: `# ${table} messages`,
      }),
      event: plural(count, {
        one: `${table} event`,
        other: `# ${table} events`,
      }),
      file: plural(count, {
        one: `${table} file`,
        other: `# ${table} files`,
      }),
      task: plural(count, {
        one: `${table} task`,
        other: `# ${table} tasks`,
      }),
      row: plural(count, {
        one: `${table} row`,
        other: `# ${table} rows`,
      }),
      other: plural(count, {
        one: `${table} item`,
        other: `# ${table} items`,
      }),
    }),
  });

/**
 * The kind as a noun; more than one reads as a count, e.g. "3 rows". A
 * `table` the record is one of qualifies the kind: "account row".
 */
export const gistKindLabel = (
  kind: GistKind,
  count: number,
  table?: string,
): string => {
  if (table !== undefined && table.length > 0) {
    return tableKindLabel(kind, count, table);
  }
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
    case "share.ask":
      return t({
        id: "toolGist.share.ask",
        message: select(shape, {
          full: `Share ${kind} ${title} in ${where}`,
          titled: `Share ${kind} ${title}`,
          placed: `Share ${kind} in ${where}`,
          other: `Share ${kind}`,
        }),
      });
    case "share.done":
      return t({
        id: "toolGist.share.done",
        message: select(shape, {
          full: `Shared ${kind} ${title} in ${where}`,
          titled: `Shared ${kind} ${title}`,
          placed: `Shared ${kind} in ${where}`,
          other: `Shared ${kind}`,
        }),
      });
    case "share.failed":
      return t({
        id: "toolGist.share.failed",
        message: select(shape, {
          full: `Could not share ${kind} ${title} in ${where}`,
          titled: `Could not share ${kind} ${title}`,
          placed: `Could not share ${kind} in ${where}`,
          other: `Could not share ${kind}`,
        }),
      });
    case "run.ask":
      return t({
        id: "toolGist.run.ask",
        message: select(shape, {
          full: `Run ${kind} ${title} in ${where}`,
          titled: `Run ${kind} ${title}`,
          placed: `Run ${kind} in ${where}`,
          other: `Run ${kind}`,
        }),
      });
    case "run.done":
      return t({
        id: "toolGist.run.done",
        message: select(shape, {
          full: `Ran ${kind} ${title} in ${where}`,
          titled: `Ran ${kind} ${title}`,
          placed: `Ran ${kind} in ${where}`,
          other: `Ran ${kind}`,
        }),
      });
    case "run.failed":
      return t({
        id: "toolGist.run.failed",
        message: select(shape, {
          full: `Could not run ${kind} ${title} in ${where}`,
          titled: `Could not run ${kind} ${title}`,
          placed: `Could not run ${kind} in ${where}`,
          other: `Could not run ${kind}`,
        }),
      });
    case "upsert.ask":
      return t({
        id: "toolGist.upsert.ask",
        message: select(shape, {
          full: `Create or update ${kind} ${title} in ${where}`,
          titled: `Create or update ${kind} ${title}`,
          placed: `Create or update ${kind} in ${where}`,
          other: `Create or update ${kind}`,
        }),
      });
    case "upsert.done":
      return t({
        id: "toolGist.upsert.done",
        message: select(shape, {
          full: `Created or updated ${kind} ${title} in ${where}`,
          titled: `Created or updated ${kind} ${title}`,
          placed: `Created or updated ${kind} in ${where}`,
          other: `Created or updated ${kind}`,
        }),
      });
    case "upsert.failed":
      return t({
        id: "toolGist.upsert.failed",
        message: select(shape, {
          full: `Could not create or update ${kind} ${title} in ${where}`,
          titled: `Could not create or update ${kind} ${title}`,
          placed: `Could not create or update ${kind} in ${where}`,
          other: `Could not create or update ${kind}`,
        }),
      });
    case "archive.ask":
      return t({
        id: "toolGist.archive.ask",
        message: select(shape, {
          full: `Archive ${kind} ${title} in ${where}`,
          titled: `Archive ${kind} ${title}`,
          placed: `Archive ${kind} in ${where}`,
          other: `Archive ${kind}`,
        }),
      });
    case "archive.done":
      return t({
        id: "toolGist.archive.done",
        message: select(shape, {
          full: `Archived ${kind} ${title} in ${where}`,
          titled: `Archived ${kind} ${title}`,
          placed: `Archived ${kind} in ${where}`,
          other: `Archived ${kind}`,
        }),
      });
    case "archive.failed":
      return t({
        id: "toolGist.archive.failed",
        message: select(shape, {
          full: `Could not archive ${kind} ${title} in ${where}`,
          titled: `Could not archive ${kind} ${title}`,
          placed: `Could not archive ${kind} in ${where}`,
          other: `Could not archive ${kind}`,
        }),
      });
    case "upload.ask":
      return t({
        id: "toolGist.upload.ask",
        message: select(shape, {
          full: `Upload ${kind} ${title} to ${where}`,
          titled: `Upload ${kind} ${title}`,
          placed: `Upload ${kind} to ${where}`,
          other: `Upload ${kind}`,
        }),
      });
    case "upload.done":
      return t({
        id: "toolGist.upload.done",
        message: select(shape, {
          full: `Uploaded ${kind} ${title} to ${where}`,
          titled: `Uploaded ${kind} ${title}`,
          placed: `Uploaded ${kind} to ${where}`,
          other: `Uploaded ${kind}`,
        }),
      });
    case "upload.failed":
      return t({
        id: "toolGist.upload.failed",
        message: select(shape, {
          full: `Could not upload ${kind} ${title} to ${where}`,
          titled: `Could not upload ${kind} ${title}`,
          placed: `Could not upload ${kind} to ${where}`,
          other: `Could not upload ${kind}`,
        }),
      });
  }
};

/**
 * The line of a call that runs something the card cannot read: the kind of
 * content takes the place of the kind of thing.
 */
export const gistRunSentence = (
  opaque: ToolCallOpaqueKind,
  phase: GistPhase,
  where: string | undefined,
): string => {
  const place = where ?? "";
  const placed = where === undefined ? "other" : "placed";
  const key: `${ToolCallOpaqueKind}.${GistPhase}` = `${opaque}.${phase}`;
  switch (key) {
    case "sql.ask":
      return t({
        id: "toolGist.runSql.ask",
        message: select(placed, {
          placed: `Run this SQL in ${place}`,
          other: "Run this SQL",
        }),
      });
    case "sql.done":
      return t({
        id: "toolGist.runSql.done",
        message: select(placed, {
          placed: `Ran this SQL in ${place}`,
          other: "Ran this SQL",
        }),
      });
    case "sql.failed":
      return t({
        id: "toolGist.runSql.failed",
        message: select(placed, {
          placed: `Could not run this SQL in ${place}`,
          other: "Could not run this SQL",
        }),
      });
    case "shell.ask":
      return t({
        id: "toolGist.runShell.ask",
        message: select(placed, {
          placed: `Run this command in ${place}`,
          other: "Run this command",
        }),
      });
    case "shell.done":
      return t({
        id: "toolGist.runShell.done",
        message: select(placed, {
          placed: `Ran this command in ${place}`,
          other: "Ran this command",
        }),
      });
    case "shell.failed":
      return t({
        id: "toolGist.runShell.failed",
        message: select(placed, {
          placed: `Could not run this command in ${place}`,
          other: "Could not run this command",
        }),
      });
    case "code.ask":
      return t({
        id: "toolGist.runCode.ask",
        message: select(placed, {
          placed: `Run this code in ${place}`,
          other: "Run this code",
        }),
      });
    case "code.done":
      return t({
        id: "toolGist.runCode.done",
        message: select(placed, {
          placed: `Ran this code in ${place}`,
          other: "Ran this code",
        }),
      });
    case "code.failed":
      return t({
        id: "toolGist.runCode.failed",
        message: select(placed, {
          placed: `Could not run this code in ${place}`,
          other: "Could not run this code",
        }),
      });
    case "instruction.ask":
      return t({
        id: "toolGist.runInstruction.ask",
        message: select(placed, {
          placed: `Hand this instruction to another assistant in ${place}`,
          other: "Hand this instruction to another assistant",
        }),
      });
    case "instruction.done":
      return t({
        id: "toolGist.runInstruction.done",
        message: select(placed, {
          placed: `Handed this instruction to another assistant in ${place}`,
          other: "Handed this instruction to another assistant",
        }),
      });
    case "instruction.failed":
      return t({
        id: "toolGist.runInstruction.failed",
        message: select(placed, {
          placed: `Could not hand this instruction to another assistant in ${place}`,
          other: "Could not hand this instruction to another assistant",
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
): string => {
  const opaque = gist.change?.opaque[0];
  if (gist.action === "run" && opaque) {
    return gistRunSentence(
      opaque.kind,
      phase,
      item.where.length > 0 ? GIST_WHERE_SLOT : undefined,
    );
  }
  return gistSentence({
    action: gist.action,
    phase,
    // A batch is counted in the line and named in its rows.
    shape: gistShape(namesInLine(item), item.where.length > 0),
    kind: gistKindLabel(gist.kind, item.count, gist.change?.table),
    title: GIST_TITLE_SLOT,
    where: GIST_WHERE_SLOT,
  });
};

/**
 * The line under an item's sentence when the one record it acts on is named
 * only by an ID no result in this chat held, so nothing could name it: which
 * record it is stays unknown here, and the ID is in the card's details.
 */
export const gistUnreadRecordLine = (gist: Gist): string => {
  const kind = gist.kind;
  const noun = gistKindLabel(kind, 1, gist.change?.table);
  const details = t({
    id: "toolCall.technicalDetails",
    message: "Technical details",
  });
  return t({
    id: "toolGist.unreadRecord",
    message: select(kind, {
      other: `Which ${noun}: not read in this chat (its ID is in ${details})`,
    }),
  });
};

/**
 * Whether an item's line is followed by the line that its record was not
 * read: the backend says so for the label's first item only, and only a line
 * that names nothing needs it.
 */
export const showsUnreadRecord = (gist: Gist, item: GistItem): boolean =>
  gist.change?.recordUnread === true &&
  gist.items[0] === item &&
  item.count === 1 &&
  item.names.length === 0;

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
