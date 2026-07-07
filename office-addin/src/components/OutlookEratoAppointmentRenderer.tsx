import {
  ActionConfirmationCard,
  useOutlookArtifact,
  usePersistedState,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ACTION_BUTTON_CLASS,
  PRIMARY_ACTION_BUTTON_CLASS,
} from "./clientActionButtonStyles";
import { useClientActionConfirmFlow } from "../hooks/useClientActionConfirmFlow";
import { useOutlookMailItem } from "../providers/OutlookMailItemProvider";
import {
  CLIENT_ACTION_DECISIONS_KEY,
  DEFAULT_CLIENT_ACTION_DECISIONS,
  clientActionDecisionsPersistedOptions,
  decisionKey,
  isActionDenied,
} from "../utils/clientActionPolicy";
import {
  clientActionDisplayLabel,
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
 * The appointment's time range for the summary and the confirmation card,
 * rendered in the runtime's local zone — which is the zone the facet template
 * instructed the model to emit (`{{timezone}}` is captured from the same
 * runtime at send time).
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
 * in main.tsx.
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
 * wrong email". The auto-prompt freshness/identity guards still apply — they
 * gate SURFACING, not payload correctness.
 *
 * While the fence is still streaming (or the model emitted malformed JSON)
 * the payload doesn't parse; the raw content renders as a muted block with no
 * actions, and the completed message re-renders into the card.
 */
export function OutlookEratoAppointmentRenderer({
  content,
}: EratoAppointmentCodeBlockProps) {
  const { itemIdentity } = useOutlookMailItem();
  const artifact = useOutlookArtifact();
  const [decisions, setDecisions] = usePersistedState(
    CLIENT_ACTION_DECISIONS_KEY,
    DEFAULT_CLIENT_ACTION_DECISIONS,
    clientActionDecisionsPersistedOptions,
  );
  const facetId = artifact?.facetId ?? "";
  const enforcedAskActions = useMemo(
    () => artifact?.alwaysAskClientActions ?? [],
    [artifact],
  );
  const details = useMemo(() => parseAppointmentDetails(content), [content]);

  const offeredActions = useMemo<OutlookAppointmentClientAction[]>(
    () =>
      // The capability check is host-static for the session (see
      // isCreateAppointmentSupported), so reading it inside this memo cannot
      // go stale the way a live-item check would.
      details && isCreateAppointmentSupported()
        ? offerableAppointmentClientActions(
            artifact?.allowedClientActions,
          ).filter(
            (action) =>
              !isActionDenied({
                facetId,
                action,
                decisions,
                enforcedAskActions,
              }),
          )
        : [],
    [details, artifact, facetId, decisions, enforcedAskActions],
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

  /** Resolves `true` only when the appointment form actually opened. */
  const executeAppointment = useCallback(async (): Promise<boolean> => {
    if (!details || !isCreateAppointmentSupported()) {
      setStatus("error");
      scheduleStatusReset(4000);
      return false;
    }
    setStatus("opening");
    try {
      await openNewAppointmentForm(details);
      setStatus("done");
      scheduleStatusReset(2000);
      return true;
    } catch (err) {
      console.warn("Failed to open the new appointment form:", err);
      setStatus("error");
      scheduleStatusReset(4000);
      return false;
    }
  }, [details, scheduleStatusReset]);

  const buildSummary = useCallback(() => details, [details]);

  // Shared confirm-card state machine + auto-prompt one-shot. The summary is
  // the parsed fence payload — exactly what the form will be prefilled with.
  // create_appointment is item-independent (payload lives in the fence, form
  // sits on the mailbox), so passing the send-time identity as the current one
  // makes the identity gate a no-op; freshness/latest/once-per-message still
  // bound WHEN it auto-prompts. Also covers unsaved-compose, whose minted
  // identity re-mints on every re-resolve and could never match itself.
  const {
    confirmCard,
    isConfirmPending,
    requestConfirmation,
    allowCard,
    denyCard,
  } = useClientActionConfirmFlow<
    AppointmentDetails,
    OutlookAppointmentClientAction
  >({
    promptScope: "appointment",
    facetId: artifact?.facetId,
    decisions,
    enforcedAskActions,
    buildSummary,
    execute: executeAppointment,
    itemIdentity,
    presentation: artifact?.clientActionPresentation,
    messageId: artifact?.messageId,
    isFreshCompletion: !!artifact?.isFreshCompletion,
    proposedAction,
    expectedItemIdentity: artifact?.itemIdentity,
    currentItemIdentity: artifact?.itemIdentity,
  });

  const handleActionClick = useCallback(
    (action: OutlookAppointmentClientAction) => {
      // Unlike the reply buttons, a click here IS the consent: the action is
      // item-independent and inherently safe (opens a prefilled form; nothing
      // is saved or sent), and the card would only restate what the summary
      // above the button already shows. The confirmation card serves the
      // AUTO-surfaced proposal path; it interposes on clicks only when the
      // deployment enforces per-use confirmation (client_actions_always_ask).
      if (!enforcedAskActions.includes(action)) {
        void executeAppointment();
        return;
      }
      if (!requestConfirmation(action)) {
        setStatus("error");
        scheduleStatusReset(4000);
      }
    },
    [
      enforcedAskActions,
      executeAppointment,
      requestConfirmation,
      scheduleStatusReset,
    ],
  );

  // Streaming / malformed payload: no actionable card, keep the raw text
  // visible but unstyled as an artifact.
  if (!details) {
    return (
      <div className="my-2 rounded-lg border border-theme-border bg-theme-bg-secondary p-3">
        <pre className="whitespace-pre-wrap break-words text-xs text-theme-fg-muted">
          {content}
        </pre>
      </div>
    );
  }

  const when = formatAppointmentWhen(details);
  const attendeesText = formatAttendees(details);

  return (
    <div className="my-2 rounded-lg border border-theme-border bg-theme-bg-secondary p-3">
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
              onClick={() => handleActionClick(action)}
              disabled={isBusy || isConfirmPending}
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
      {confirmCard && (
        <ActionConfirmationCard
          // Keyed per request: a replacement card remounts so the mount-only
          // scroll/focus behavior applies to the new confirmation.
          key={confirmCard.requestId}
          description={
            <div className="space-y-2 text-sm text-theme-fg-secondary">
              <p className="font-medium text-theme-fg-primary">
                {clientActionDisplayLabel(confirmCard.action)}
              </p>
              <p>
                {t({
                  id: "officeAddin.appointmentRenderer.confirmMessage",
                  message:
                    "This opens a prefilled appointment form in Outlook. Nothing is saved or sent until you do it there.",
                })}
              </p>
              <p className="break-words text-xs">
                {formatAppointmentWhen(confirmCard.summary)}
                {confirmCard.summary.attendees.length > 0 ||
                (confirmCard.summary.optionalAttendees?.length ?? 0) > 0
                  ? ` · ${formatAttendees(confirmCard.summary)}`
                  : ""}
              </p>
            </div>
          }
          onAllowOnce={() => allowCard(confirmCard)}
          onAlwaysAllow={() => {
            // Persist the grant for THIS facet + action, then execute. The
            // store is the source the settings page mirrors and revises.
            setDecisions({
              ...decisions,
              [decisionKey(facetId, confirmCard.action)]: "always",
            });
            allowCard(confirmCard);
          }}
          alwaysAllowDisabledReason={
            enforcedAskActions.includes(confirmCard.action)
              ? t({
                  id: "officeAddin.appointmentRenderer.alwaysAllowLocked",
                  message:
                    "Your organization requires confirmation for this action every time.",
                })
              : undefined
          }
          onDeny={() => denyCard(confirmCard)}
          isBusy={isBusy}
          scrollIntoViewOnMount={confirmCard.autoTriggered}
        />
      )}
    </div>
  );
}
