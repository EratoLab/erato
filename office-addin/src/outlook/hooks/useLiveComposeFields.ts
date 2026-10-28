import { useCallback, useEffect, useRef, useState } from "react";

import { callOfficeAsync } from "../../utils/officeAsync";
import {
  readAppointmentComposeSnapshot,
  type AppointmentComposeSnapshot,
} from "../providers/OutlookMailItemProvider";
import {
  isAppointmentCompose,
  isMessageRead,
  resolveSupportedMailboxItem,
  type SupportedOutlookItem,
} from "../sessionPolicy/outlookAnchor";
import { outlookAppointmentFingerprint } from "../utils/outlookActionFacet";
import {
  readComposeRecipients,
  serializeComposeRecipients,
  type ComposeRecipients,
} from "../utils/outlookComposeRecipients";

export type LiveComposeFieldsWatch = "message" | "appointment";

export interface LiveComposeFields {
  /** The message draft's body as text, as a send reads it. */
  bodyText?: string;
  /** To/CC/BCC serialized as a send reads them. */
  recipients?: string;
  /** The recipients themselves, for the draft's detail. */
  recipientList?: ComposeRecipients;
  /** The appointment's de-dup key as a send reads it. */
  appointmentFingerprint?: string;
  /** The appointment as a send reads it, for its detail. */
  appointment?: AppointmentComposeSnapshot;
}

export interface LiveComposeDraft {
  /** What the reads so far found for this item; a field never read is absent. */
  fields: LiveComposeFields;
  /**
   * Reads the live item now and keeps what it found unless a later read has
   * started. Resolves to this read alone, without the fields it could not
   * read; never rejects.
   */
  refresh: () => Promise<LiveComposeFields>;
}

/**
 * The same bound as the recipient reads, so a message send waits at most
 * this long for the draft before it goes with the body read last.
 */
export const LIVE_BODY_READ_TIMEOUT_MS = 2_000;

// Mailbox 1.7 (recipients, time) and 1.8 (locations); a host without one
// simply never reports that edit.
const WATCHED_EVENTS: Record<LiveComposeFieldsWatch, readonly string[]> = {
  message: ["RecipientsChanged"],
  appointment: [
    "RecipientsChanged",
    "AppointmentTimeChanged",
    "EnhancedLocationsChanged",
  ],
};

const NOTHING_READ: LiveComposeFields = {};

async function readComposeBodyText(
  item: Office.MessageCompose,
): Promise<string | undefined> {
  if (typeof item.body?.getAsync !== "function") return undefined;
  try {
    return await callOfficeAsync<string>(
      (callback) => item.body.getAsync(Office.CoercionType.Text, callback),
      { timeoutMs: LIVE_BODY_READ_TIMEOUT_MS },
    );
  } catch {
    return undefined;
  }
}

async function readLiveFields(
  item: Exclude<SupportedOutlookItem, Office.MessageRead>,
  watch: LiveComposeFieldsWatch,
  readRecipients: boolean,
  appointmentFallback: AppointmentComposeSnapshot,
): Promise<LiveComposeFields> {
  if (isAppointmentCompose(item)) {
    if (watch !== "appointment") return {};
    const snapshot = await readAppointmentComposeSnapshot(
      item,
      appointmentFallback,
    );
    return snapshot
      ? {
          appointment: snapshot,
          appointmentFingerprint: outlookAppointmentFingerprint(snapshot),
        }
      : {};
  }
  if (watch !== "message") return {};
  const [bodyText, recipientList] = await Promise.all([
    readComposeBodyText(item),
    readRecipients ? readComposeRecipients(item) : undefined,
  ]);
  return {
    ...(bodyText !== undefined ? { bodyText } : {}),
    ...(recipientList
      ? {
          recipientList,
          recipients: serializeComposeRecipients(recipientList),
        }
      : {}),
  };
}

function resolveComposeItem(): Exclude<
  SupportedOutlookItem,
  Office.MessageRead
> | null {
  try {
    const item = resolveSupportedMailboxItem(Office.context.mailbox?.item);
    return item && !isMessageRead(item) ? item : null;
  } catch {
    return null;
  }
}

/**
 * The draft as the next send would read it. Body edits fire no event at all,
 * and recipient and appointment-form edits only their own item events, so the
 * mail item provider's bind-time fields go stale. This re-reads the live item
 * on those events, when the pane gains focus (the user is back from typing in
 * the item), and whenever a caller asks: the send, and the draft's open
 * detail. Until a read lands nothing is known, and callers keep the
 * provider's fields.
 */
export function useLiveComposeFields({
  watch,
  itemIdentity,
  readRecipients,
  appointmentFallback,
}: {
  watch: LiveComposeFieldsWatch | null;
  itemIdentity: string | null;
  /** Read To/CC/BCC as well, for a message: a facet the send attaches carries them. */
  readRecipients: boolean;
  /** What the send falls back to per field, so both reads agree. */
  appointmentFallback: AppointmentComposeSnapshot;
}): LiveComposeDraft {
  const scope = watch ? `${watch}:${itemIdentity ?? ""}` : null;
  const [read, setRead] = useState<{
    scope: string;
    fields: LiveComposeFields;
  } | null>(null);
  const fallbackRef = useRef(appointmentFallback);
  fallbackRef.current = appointmentFallback;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const latestReadRef = useRef(0);

  const refresh = useCallback(async (): Promise<LiveComposeFields> => {
    if (!watch || scope === null) return NOTHING_READ;
    const readId = ++latestReadRef.current;
    const item = resolveComposeItem();
    if (!item) return NOTHING_READ;
    let fields: LiveComposeFields;
    try {
      fields = await readLiveFields(
        item,
        watch,
        readRecipients,
        fallbackRef.current,
      );
    } catch {
      return NOTHING_READ;
    }
    if (readId === latestReadRef.current && scopeRef.current === scope) {
      setRead((previous) => {
        const known = previous?.scope === scope ? previous.fields : {};
        const next = { ...known, ...fields };
        // The open detail re-reads on a timer; an unchanged draft must not
        // re-render the composer each time.
        return previous?.scope === scope &&
          JSON.stringify(next) === JSON.stringify(known)
          ? previous
          : { scope, fields: next };
      });
    }
    return fields;
  }, [readRecipients, scope, watch]);

  useEffect(() => {
    if (!watch || scope === null) return;
    const live = resolveComposeItem();
    if (!live) return;
    if ((watch === "appointment") !== isAppointmentCompose(live)) return;

    const reread = () => {
      void refresh();
    };
    window.addEventListener("focus", reread);

    const eventTypes = (
      watch === "appointment" || readRecipients ? WATCHED_EVENTS[watch] : []
    )
      .map(
        (name) =>
          (Office.EventType as unknown as Record<string, string | undefined>)[
            name
          ],
      )
      .filter((eventType): eventType is string => !!eventType);
    const registered: string[] = [];
    if (typeof live.addHandlerAsync === "function") {
      for (const eventType of eventTypes) {
        try {
          live.addHandlerAsync(eventType, reread, () => {});
          registered.push(eventType);
        } catch {
          // An event the host does not know leaves that edit unreported.
        }
      }
    }

    return () => {
      window.removeEventListener("focus", reread);
      for (const eventType of registered) {
        try {
          live.removeHandlerAsync(eventType);
        } catch {
          // Best-effort: the item may already be gone.
        }
      }
    };
  }, [readRecipients, refresh, scope, watch]);

  return {
    fields: read && read.scope === scope ? read.fields : NOTHING_READ,
    refresh,
  };
}
