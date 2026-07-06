import { callOfficeAsync } from "./officeAsync";

// A wedged host could drop the callback and hang the open forever — bound it.
const APPOINTMENT_FORM_TIMEOUT_MS = 15_000;

/**
 * The appointment the model emitted inside its fenced `erato-appointment`
 * block, validated into a shape the Office.js new-appointment form accepts.
 * `start`/`end` are the ISO-8601 strings the model produced (local,
 * offset-bearing per the facet template); they are turned into `Date`s only at
 * the point the form opens. Recurrence is deliberately absent: the form API
 * has no recurrence property and none is ever prefilled.
 */
export interface AppointmentDetails {
  start: string;
  end: string;
  subject: string;
  attendees: string[];
  optionalAttendees?: string[];
  location?: string;
  body?: string;
}

/** Thrown when the new-appointment form could not be opened. */
export class AppointmentFormError extends Error {
  constructor(cause?: unknown) {
    super("Failed to open the new appointment form");
    this.name = "AppointmentFormError";
    this.cause = cause;
  }
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isParseableDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * Parse the JSON payload of an `erato-appointment` fence (the renderer
 * receives the fence body directly). Returns `null` when the JSON is
 * unparseable (including mid-stream truncation), the required `start`/`end`
 * are missing, they don't parse as dates, or `end` is not after `start` — the
 * caller then simply shows no actionable card. Never throws.
 */
export function parseAppointmentDetails(
  fenceBody: string,
): AppointmentDetails | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fenceBody.trim());
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.start !== "string" || typeof obj.end !== "string") {
    return null;
  }
  if (!isParseableDate(obj.start) || !isParseableDate(obj.end)) {
    return null;
  }
  // Reject inverted/zero-length ranges — never open a negative-duration form.
  if (new Date(obj.end).getTime() <= new Date(obj.start).getTime()) {
    return null;
  }

  const details: AppointmentDetails = {
    start: obj.start,
    end: obj.end,
    subject: typeof obj.subject === "string" ? obj.subject : "",
    attendees: toStringArray(obj.attendees),
  };
  const optionalAttendees = toStringArray(obj.optionalAttendees);
  if (optionalAttendees.length > 0) {
    details.optionalAttendees = optionalAttendees;
  }
  if (typeof obj.location === "string") {
    details.location = obj.location;
  }
  if (typeof obj.body === "string") {
    details.body = obj.body;
  }
  return details;
}

/**
 * Whether this host can open a new-appointment form: Mailbox 1.1 and not
 * Outlook on iOS/Android, where `displayNewAppointmentForm` is unsupported.
 * Host-static for the session — `displayNewAppointmentForm` lives on
 * `Office.context.mailbox` (NOT the item), so unlike the reply forms it needs
 * no live-item guard and works in read, compose, and no-item contexts alike.
 */
export function isCreateAppointmentSupported(): boolean {
  const hostName = Office.context?.mailbox?.diagnostics?.hostName;
  if (hostName === "OutlookIOS" || hostName === "OutlookAndroid") {
    return false;
  }
  return (
    Office.context.requirements?.isSetSupported?.("Mailbox", "1.1") ?? false
  );
}

/**
 * Open Outlook's native new-appointment form prefilled with the parsed
 * details. This never sends or saves anything — the user reviews and Saves or
 * Sends in Outlook's own appointment window.
 *
 * Throws {@link AppointmentFormError} when the host refuses to open the form
 * so the confirm card can resolve into its failure record.
 */
export async function openNewAppointmentForm(
  details: AppointmentDetails,
): Promise<void> {
  const form: Office.AppointmentForm = {
    requiredAttendees: details.attendees,
    ...(details.optionalAttendees
      ? { optionalAttendees: details.optionalAttendees }
      : {}),
    start: new Date(details.start),
    end: new Date(details.end),
    subject: details.subject,
    ...(details.location !== undefined ? { location: details.location } : {}),
    ...(details.body !== undefined ? { body: details.body } : {}),
  };
  const supportsAsync =
    Office.context.requirements?.isSetSupported?.("Mailbox", "1.9") ?? false;
  try {
    if (supportsAsync) {
      await callOfficeAsync<void>(
        (callback) =>
          Office.context.mailbox.displayNewAppointmentFormAsync(form, callback),
        { timeoutMs: APPOINTMENT_FORM_TIMEOUT_MS },
      );
    } else {
      Office.context.mailbox.displayNewAppointmentForm(form);
    }
  } catch (error) {
    throw new AppointmentFormError(error);
  }
}
