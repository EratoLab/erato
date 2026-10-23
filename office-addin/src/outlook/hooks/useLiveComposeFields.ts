import { useEffect, useRef, useState } from "react";

import {
  readAppointmentComposeSnapshot,
  type AppointmentComposeSnapshot,
} from "../providers/OutlookMailItemProvider";
import {
  isAppointmentCompose,
  isMessageRead,
  resolveSupportedMailboxItem,
} from "../sessionPolicy/outlookAnchor";
import { outlookAppointmentFingerprint } from "../utils/outlookActionFacet";
import {
  readComposeRecipients,
  serializeComposeRecipients,
  type ComposeRecipients,
} from "../utils/outlookComposeRecipients";

export type LiveComposeFieldsWatch = "recipients" | "appointment";

export interface LiveComposeFields {
  /** To/CC/BCC serialized as a send reads them, after the last reported edit. */
  recipients?: string;
  /** The appointment's de-dup key as a send reads it, after the last reported edit. */
  appointmentFingerprint?: string;
  /** The recipients themselves, for the draft's detail. */
  recipientList?: ComposeRecipients;
  /** The appointment as a send reads it, for its detail. */
  appointment?: AppointmentComposeSnapshot;
}

// Mailbox 1.7 (recipients, time) and 1.8 (locations); a host without one
// simply never reports that edit.
const WATCHED_EVENTS: Record<LiveComposeFieldsWatch, readonly string[]> = {
  recipients: ["RecipientsChanged"],
  appointment: [
    "RecipientsChanged",
    "AppointmentTimeChanged",
    "EnhancedLocationsChanged",
  ],
};

const NOTHING_READ: LiveComposeFields = {};

/**
 * Recipient and appointment-form edits fire no ItemChanged, so the mail item
 * provider's fields go stale. Their own item events re-read what the next
 * send would read. Until one fires nothing is known, and callers keep the
 * values the last send read.
 */
export function useLiveComposeFields({
  watch,
  itemIdentity,
  appointmentFallback,
}: {
  watch: LiveComposeFieldsWatch | null;
  itemIdentity: string | null;
  /** What the send falls back to per field, so both reads agree. */
  appointmentFallback: AppointmentComposeSnapshot;
}): LiveComposeFields {
  const scope = watch ? `${watch}:${itemIdentity ?? ""}` : null;
  const [read, setRead] = useState<{
    scope: string;
    fields: LiveComposeFields;
  } | null>(null);
  const fallbackRef = useRef(appointmentFallback);
  fallbackRef.current = appointmentFallback;

  useEffect(() => {
    if (!watch || scope === null) return;
    let item: ReturnType<typeof resolveSupportedMailboxItem> = null;
    try {
      item = resolveSupportedMailboxItem(Office.context.mailbox?.item);
    } catch {
      return;
    }
    if (!item || isMessageRead(item)) return;
    const live = item;
    const isAppointment = isAppointmentCompose(live);
    if ((watch === "appointment") !== isAppointment) return;
    if (typeof live.addHandlerAsync !== "function") return;

    let active = true;
    let latest = 0;
    const reread = () => {
      const readId = ++latest;
      const next: Promise<LiveComposeFields> = isAppointmentCompose(live)
        ? readAppointmentComposeSnapshot(live, fallbackRef.current).then(
            (snapshot) => ({
              appointmentFingerprint: outlookAppointmentFingerprint(snapshot),
              appointment: snapshot,
            }),
          )
        : readComposeRecipients(live).then((recipients) => ({
            recipients: serializeComposeRecipients(recipients),
            recipientList: recipients,
          }));
      void next
        .then((fields) => {
          if (active && readId === latest) setRead({ scope, fields });
        })
        .catch(() => {});
    };

    const eventTypes = WATCHED_EVENTS[watch]
      .map(
        (name) =>
          (Office.EventType as unknown as Record<string, string | undefined>)[
            name
          ],
      )
      .filter((eventType): eventType is string => !!eventType);
    const registered: string[] = [];
    for (const eventType of eventTypes) {
      try {
        live.addHandlerAsync(eventType, reread, () => {});
        registered.push(eventType);
      } catch {
        // An event the host does not know leaves that edit unreported.
      }
    }

    return () => {
      active = false;
      for (const eventType of registered) {
        try {
          live.removeHandlerAsync(eventType);
        } catch {
          // Best-effort: the item may already be gone.
        }
      }
    };
  }, [scope, watch]);

  return read && read.scope === scope ? read.fields : NOTHING_READ;
}
