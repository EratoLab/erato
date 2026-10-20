import { plural, t } from "@lingui/core/macro";

import { OUTLOOK_REPLY_FROM_READ_FACET_ID } from "./outlookClientActions";
import { formatAppointmentWhen } from "./outlookContextFormat";
import { OUTLOOK_SCHEDULE_FACET_ID } from "./outlookScheduleTool";
import {
  quotedSelection,
  selectionExcerpt,
} from "../../core/selection/selectionExcerpt";

import type { SentWithDescriptor } from "@erato/frontend/library";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The To line's first name and how many follow it; null for a list that does not parse. */
function toRecipients(
  serialized: string | undefined,
): { first: string; others: number } | null {
  if (!serialized) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.to)) return null;
  const names = parsed.to.flatMap((recipient: unknown) => {
    if (!isRecord(recipient)) return [];
    const name =
      typeof recipient.displayName === "string"
        ? recipient.displayName.trim()
        : "";
    const address =
      typeof recipient.emailAddress === "string"
        ? recipient.emailAddress.trim()
        : "";
    return name || address ? [name || address] : [];
  });
  return names.length > 0
    ? { first: names[0], others: names.length - 1 }
    : null;
}

const draftChips: SentWithDescriptor = (args) => {
  const to = toRecipients(args.recipients);
  const first = to?.first ?? "";
  const others = to?.others ?? 0;
  return [
    {
      id: "outlook.draft",
      kind: "outlook.draft",
      icon: "draft",
      label: t({
        id: "officeAddin.outlook.context.draft.label",
        message: "Your draft",
      }),
      spokenLabel: t({
        id: "officeAddin.outlook.context.draft.spoken",
        message: "Draft",
      }),
      ...(args.full_body ? { quote: args.full_body } : {}),
      ...(to
        ? {
            meta: t({
              id: "officeAddin.outlook.sentWith.draft.meta.to",
              message: plural(others, {
                0: `To ${first}`,
                other: `To ${first} +#`,
              }),
            }),
          }
        : {}),
    },
  ];
};

const appointmentChips: SentWithDescriptor = (args) => {
  const label = t({
    id: "officeAddin.outlook.context.appointment.label",
    message: "Appointment details",
  });
  const when = formatAppointmentWhen(args.start, args.end, {
    timeZone: args.timezone || undefined,
  });
  return [
    {
      id: "outlook.appointment",
      kind: "outlook.appointment",
      icon: "calendar",
      label,
      spokenLabel: label,
      ...(args.full_body ? { quote: args.full_body } : {}),
      ...(when ? { meta: when } : {}),
    },
  ];
};

const selectionChips: SentWithDescriptor = (args) => {
  const text = args.selected_text ?? "";
  const spokenLabel = t({
    id: "officeAddin.outlook.context.selection.spoken",
    message: "Selection",
  });
  return [
    {
      id: "outlook.selection",
      kind: "outlook.selection",
      icon: "selection",
      label: text ? quotedSelection(selectionExcerpt(text)) : spokenLabel,
      spokenLabel,
      meta: t({
        id: "officeAddin.outlook.context.selection.title",
        message: "Selected text",
      }),
      ...(text ? { quote: text } : {}),
    },
  ];
};

// These carry no user content: a mode, a reply to the open email (an upload
// of its own), or an empty compose.
const noContent: SentWithDescriptor = () => null;

/**
 * How a sent Outlook request names what it carried, by facet: the draft, the
 * appointment, or the selected text, named as the composer chips name them.
 */
export const outlookSentWithDescriptors: Readonly<
  Record<string, SentWithDescriptor>
> = {
  outlook_review_draft: draftChips,
  outlook_review_appointment: appointmentChips,
  outlook_rewrite_selection: selectionChips,
  outlook_rewrite_appointment_selection: selectionChips,
  [OUTLOOK_SCHEDULE_FACET_ID]: noContent,
  [OUTLOOK_REPLY_FROM_READ_FACET_ID]: noContent,
  compose_email: noContent,
};
