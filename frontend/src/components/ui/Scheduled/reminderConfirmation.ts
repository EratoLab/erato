import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/* eslint-disable lingui/no-unlocalized-strings -- wire names and keys, not copy */

/** The model's tool that schedules a reminder from a chat (ERMAIN-902). */
export const CREATE_REMINDER_TOOL_NAME = "create_reminder";

/**
 * The confirmation card after a reminder was scheduled from a chat, as the
 * backend renders it from the stored item. Every text is already in the
 * user's language and the same as on the Teams card, so the web card shows
 * these strings rather than its own.
 */
export interface ReminderConfirmation {
  itemId: string;
  heading: string;
  name: string;
  /** When it arrives next, with a zone name only if it differs from the user's. */
  when: string | null;
  /** A repeating reminder's schedule. */
  repeats: string | null;
  /** Where it arrives, e.g. "Delivered via Teams chat". */
  delivery: string;
  cancelLabel: string;
  openScheduledLabel: string;
  /** The Scheduled page, relative to the app's base URL. */
  scheduledPath: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (record: Record<string, unknown>, key: string) => {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

/** Only a path on this app, never a link elsewhere. */
const appPath = (value: string | null) =>
  value?.startsWith("/") && !value.startsWith("//") ? value : null;

/**
 * The confirmation a successful `create_reminder` call carries, or null for
 * any other part. A reminder stored without a confirmation (the backend
 * could not describe it) gets no card; the Scheduled page still lists it.
 */
export function reminderConfirmationOf(
  part: ContentPart,
): ReminderConfirmation | null {
  if (
    part.content_type !== "tool_use" ||
    part.tool_name !== CREATE_REMINDER_TOOL_NAME ||
    part.status !== "success" ||
    !isRecord(part.output) ||
    !isRecord(part.output.confirmation)
  ) {
    return null;
  }
  const confirmation = part.output.confirmation;
  const itemId = text(confirmation, "item_id");
  const heading = text(confirmation, "heading");
  const name = text(confirmation, "name");
  const delivery = text(confirmation, "delivery");
  const cancelLabel = text(confirmation, "cancel_label");
  const openScheduledLabel = text(confirmation, "open_scheduled_label");
  const scheduledPath = appPath(text(confirmation, "scheduled_path"));
  if (
    !itemId ||
    !heading ||
    !name ||
    !delivery ||
    !cancelLabel ||
    !openScheduledLabel ||
    !scheduledPath
  ) {
    return null;
  }
  return {
    itemId,
    heading,
    name,
    when: text(confirmation, "when"),
    repeats: text(confirmation, "repeats"),
    delivery,
    cancelLabel,
    openScheduledLabel,
    scheduledPath,
  };
}
/* eslint-enable lingui/no-unlocalized-strings */
