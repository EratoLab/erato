import { useOutlookArtifact } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ACTION_BUTTON_CLASS,
  PRIMARY_ACTION_BUTTON_CLASS,
} from "../../core/clientActions/clientActionButtonStyles";
import { useNeverAllowedActions } from "../../core/clientActions/useNeverAllowedActions";
import {
  offerableAppointmentClientActions,
  type OutlookAppointmentClientAction,
} from "../utils/outlookClientActions";
import {
  isCreateAppointmentSupported,
  openNewAppointmentForm,
  parseAppointmentDetails,
  type AppointmentDetails,
} from "../utils/outlookCreateAppointment";

import type { EratoAppointmentCodeBlockProps } from "@erato/frontend/library";

const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

/**
 * The appointment's time range for the summary, rendered in the runtime's
 * local zone — which is the zone the facet template instructed the model to
 * emit (`{{timezone}}` is captured from the same runtime at send time).
 */
function formatAppointmentWhen(details: AppointmentDetails): string {
  const start = new Date(details.start);
  const end = new Date(details.end);
  const startText = start.toLocaleString(undefined, DATE_TIME_FORMAT);
  const sameDay = start.toDateString() === end.toDateString();
  const endText = sameDay
    ? end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : end.toLocaleString(undefined, DATE_TIME_FORMAT);
  return `${startText} – ${endText}`;
}

/** Combined required + optional attendees as a comma-separated string. */
function formatAttendees(details: AppointmentDetails): string {
  return [...details.attendees, ...(details.optionalAttendees ?? [])].join(
    ", ",
  );
}

/**
 * Office-aware renderer for erato-appointment code blocks (the JSON payload
 * the scheduling facet's confirm step emits). Registered via componentRegistry
 * by the Outlook composition before its first chat render.
 *
 * Renders the parsed appointment as a summary card. When the producing facet
 * allows `outlook.create_appointment` (from `GET /me/facets`, intersected with
 * the add-in's fixed registry) and the host supports it (Mailbox 1.1, not
 * Outlook iOS/Android), an "Open appointment" button opens Outlook's native
 * new-appointment form prefilled from the parsed payload — the user reviews
 * and Saves/Sends there; nothing is ever created by the add-in itself.
 *
 * Unlike the reply flow, execution is deliberately NOT bound to the open
 * Outlook item: the whole payload lives in this fence, and
 * `displayNewAppointmentForm` sits on the mailbox (not the item), so it works
 * identically in read, compose, and no-item contexts and cannot act on "the
 * wrong email". A click is the user's consent; an action set to Never in the
 * tool decisions is not offered.
 *
 * While the fence is still streaming (or the model emitted malformed JSON)
 * the payload doesn't parse; the raw content renders as a muted block with no
 * actions, and the completed message re-renders into the card.
 */
export function OutlookEratoAppointmentRenderer({
  content,
}: EratoAppointmentCodeBlockProps) {
  const artifact = useOutlookArtifact();
  const neverAllowed = useNeverAllowedActions("outlook");
  const details = useMemo(() => parseAppointmentDetails(content), [content]);

  const offeredActions = useMemo<OutlookAppointmentClientAction[]>(
    () =>
      // The capability check is host-static for the session (see
      // isCreateAppointmentSupported), so reading it inside this memo cannot
      // go stale the way a live-item check would.
      details && isCreateAppointmentSupported()
        ? offerableAppointmentClientActions(
            artifact?.allowedClientActions,
          ).filter((action) => !neverAllowed.has(action))
        : [],
    [details, artifact, neverAllowed],
  );
  const proposedAction =
    artifact?.proposedClientAction &&
    (offeredActions as string[]).includes(artifact.proposedClientAction)
      ? (artifact.proposedClientAction as OutlookAppointmentClientAction)
      : undefined;

  const [status, setStatus] = useState<"idle" | "opening" | "done" | "error">(
    "idle",
  );
  const isBusy = status === "opening";

  // Single pending status-reset timer: a new schedule cancels the previous
  // one, and unmount cancels outright.
  const statusResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleStatusReset = useCallback((delayMs: number) => {
    if (statusResetRef.current) {
      clearTimeout(statusResetRef.current);
    }
    statusResetRef.current = setTimeout(() => setStatus("idle"), delayMs);
  }, []);
  useEffect(
    () => () => {
      if (statusResetRef.current) {
        clearTimeout(statusResetRef.current);
      }
    },
    [],
  );

  // A click IS the consent: the summary above the button discloses the full
  // payload, and nothing is saved or sent until the user does it in Outlook.
  const handleActionClick = useCallback(async () => {
    if (!details || !isCreateAppointmentSupported()) {
      setStatus("error");
      scheduleStatusReset(4000);
      return;
    }
    setStatus("opening");
    try {
      await openNewAppointmentForm(details);
      setStatus("done");
      scheduleStatusReset(2000);
    } catch (err) {
      console.warn("Failed to open the new appointment form:", err);
      setStatus("error");
      scheduleStatusReset(4000);
    }
  }, [details, scheduleStatusReset]);

  // Streaming / malformed payload: no actionable card, keep the raw text
  // visible but unstyled as an artifact.
  if (!details) {
    return (
      <div className="my-2 rounded-[var(--theme-radius-message)] border border-theme-border bg-theme-bg-secondary p-3">
        <pre className="whitespace-pre-wrap break-words text-xs text-theme-fg-muted">
          {content}
        </pre>
      </div>
    );
  }

  const when = formatAppointmentWhen(details);
  const attendeesText = formatAttendees(details);

  return (
    <div className="my-2 rounded-[var(--theme-radius-message)] border border-theme-border bg-theme-bg-secondary p-3">
      <dl className="mb-2 space-y-0.5 text-sm">
        <div className="flex gap-1">
          <dt className="font-medium text-theme-fg-primary">
            {t({
              id: "officeAddin.appointmentRenderer.subject",
              message: "Subject:",
            })}
          </dt>
          <dd className="min-w-0 break-words text-theme-fg-secondary">
            {details.subject ||
              t({
                id: "officeAddin.appointmentRenderer.noSubject",
                message: "(none)",
              })}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt className="font-medium text-theme-fg-primary">
            {t({
              id: "officeAddin.appointmentRenderer.when",
              message: "When:",
            })}
          </dt>
          <dd className="min-w-0 break-words text-theme-fg-secondary">
            {when}
          </dd>
        </div>
        {attendeesText && (
          <div className="flex gap-1">
            <dt className="font-medium text-theme-fg-primary">
              {t({
                id: "officeAddin.appointmentRenderer.attendees",
                message: "Attendees:",
              })}
            </dt>
            <dd className="min-w-0 break-words text-theme-fg-secondary">
              {attendeesText}
            </dd>
          </div>
        )}
        {details.location && (
          <div className="flex gap-1">
            <dt className="font-medium text-theme-fg-primary">
              {t({
                id: "officeAddin.appointmentRenderer.location",
                message: "Location:",
              })}
            </dt>
            <dd className="min-w-0 break-words text-theme-fg-secondary">
              {details.location}
            </dd>
          </div>
        )}
      </dl>
      {offeredActions.length > 0 && (
        <div className="flex gap-2">
          {offeredActions.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => void handleActionClick()}
              disabled={isBusy}
              className={
                action === proposedAction
                  ? PRIMARY_ACTION_BUTTON_CLASS
                  : ACTION_BUTTON_CLASS
              }
            >
              {isBusy
                ? t({
                    id: "officeAddin.appointmentRenderer.opening",
                    message: "Opening...",
                  })
                : status === "done"
                  ? t({
                      id: "officeAddin.appointmentRenderer.opened",
                      message: "Opened!",
                    })
                  : t({
                      id: "officeAddin.appointmentRenderer.openAppointment",
                      message: "Open appointment",
                    })}
            </button>
          ))}
        </div>
      )}
      {status === "error" && (
        <p role="alert" className="mt-1 text-xs text-theme-error-fg">
          {t({
            id: "officeAddin.appointmentRenderer.openFailed",
            message:
              "Failed to open the appointment form. You can create the appointment manually in Outlook.",
          })}
        </p>
      )}
    </div>
  );
}
