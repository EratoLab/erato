import { t } from "@lingui/core/macro";
import { useLayoutEffect, useRef, useState } from "react";
import { Link, useInRouterContext } from "react-router-dom";

import { useReminderConfirmation } from "@/hooks/scheduled/useReminderConfirmation";
import { getClientPlatform } from "@/lib/clientPlatform";
import { useScheduledFeature } from "@/providers/FeatureConfigProvider";

import { ScheduledStatusPill } from "./ScheduledStatusPill";
import { Card } from "../Container/Card";
import { Button, controlSurfaceClassName } from "../Controls/Button";
import { ConfirmationDialog } from "../Modal/ConfirmationDialog";

import type { ReminderConfirmation } from "./reminderConfirmation";
import type { ReminderConfirmationStatus } from "@/hooks/scheduled/useReminderConfirmation";
import type { ReactNode } from "react";

export interface ReminderConfirmationCardViewProps {
  confirmation: ReminderConfirmation;
  /** What became of the reminder; unknown while it loads or cannot be read. */
  status?: ReminderConfirmationStatus;
  onCancel?: () => void;
  isCancelling?: boolean;
  /** Why Cancel was refused. */
  cancelError?: string | null;
  /** Off where the app has no Scheduled page. */
  showOpenScheduled?: boolean;
  /**
   * A shared, read-only chat: only what was stored. The viewer may not be
   * the reminder's owner, so its status and actions would be theirs.
   */
  readOnly?: boolean;
}

const OPEN_SCHEDULED_CLASS = controlSurfaceClassName({ variant: "secondary" });

/**
 * Opens the Scheduled page in the app, or in a new tab from a host that is
 * not the web app (an Office add-in has no Scheduled page of its own).
 */
function OpenScheduledLink({
  path,
  children,
}: {
  path: string;
  children: ReactNode;
}) {
  const inApp = useInRouterContext() && getClientPlatform() === "web";
  return inApp ? (
    <Link
      to={path}
      className={OPEN_SCHEDULED_CLASS}
      data-testid="reminder-confirmation-open"
    >
      {children}
    </Link>
  ) : (
    <a
      href={path}
      target="_blank"
      rel="noopener noreferrer"
      className={OPEN_SCHEDULED_CLASS}
      data-testid="reminder-confirmation-open"
    >
      {children}
    </a>
  );
}

/**
 * The confirmation card after a reminder was scheduled from a chat: what was
 * stored (name, time, repeat, where it arrives), Cancel while there is still
 * something to cancel, and Open in Scheduled, where editing happens. The texts
 * come with the confirmation, so the card reads the same as in Teams.
 */
export function ReminderConfirmationCardView({
  confirmation,
  status,
  onCancel,
  isCancelling = false,
  cancelError = null,
  showOpenScheduled = true,
  readOnly = false,
}: ReminderConfirmationCardViewProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  const cancellable =
    !readOnly &&
    (status === undefined || status === "scheduled" || status === "snoozed");
  const showOpen = showOpenScheduled && !readOnly;

  // Cancel unmounts once it worked; focus would otherwise drop to <body>.
  // Only after a Cancel from this card: a reloaded chat whose reminder turns
  // out to be over must not pull focus into its history.
  const cancelStarted = useRef(false);
  useLayoutEffect(() => {
    if (!cancelStarted.current) return;
    if (!cancellable) {
      cancelStarted.current = false;
      const active = document.activeElement;
      if (active === null || active === document.body) {
        cardRef.current?.focus({ preventScroll: true });
      }
    } else if (!isCancelling) {
      cancelStarted.current = false;
    }
  }, [cancellable, isCancelling]);

  // Asks first, like the Scheduled page: a cancel ends a whole series and
  // cannot be undone, and the card stays in the chat for weeks.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const startCancel = () => {
    setConfirmingCancel(false);
    cancelStarted.current = true;
    onCancel?.();
  };

  const { heading, name } = confirmation;

  return (
    <Card
      ref={cardRef}
      variant="surface"
      size="sm"
      as="section"
      tabIndex={-1}
      aria-label={`${heading}: ${name}`}
      className="my-3 min-w-0"
      bodyClassName="space-y-3"
      data-ui="reminder-confirmation-card"
      data-testid="reminder-confirmation"
      data-status={status}
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-theme-fg-muted">{heading}</p>
          {/* Announces the change after Cancel. */}
          <span aria-live="polite" className="inline-flex">
            {status !== undefined &&
              status !== "scheduled" &&
              status !== "gone" && <ScheduledStatusPill status={status} />}
          </span>
        </div>
        <p className="text-base font-semibold text-theme-fg-primary">{name}</p>
        {confirmation.when && (
          <p className="text-sm text-theme-fg-primary">{confirmation.when}</p>
        )}
        {confirmation.repeats && (
          <p className="text-sm text-theme-fg-primary">
            {confirmation.repeats}
          </p>
        )}
        <p className="text-sm text-theme-fg-muted">{confirmation.delivery}</p>
      </div>
      {status === "gone" && (
        <p className="text-sm text-theme-fg-muted">
          {t({
            id: "scheduled.confirmation.gone",
            message: "This reminder no longer exists.",
          })}
        </p>
      )}
      {cancelError && (
        <p className="text-sm text-theme-error-fg" role="alert">
          {cancelError}
        </p>
      )}
      {(cancellable || showOpen) && (
        <div className="flex flex-wrap gap-2">
          {cancellable && (
            <Button
              variant="secondary"
              size="sm"
              onClick={
                isCancelling ? undefined : () => setConfirmingCancel(true)
              }
              busy={isCancelling}
              data-testid="reminder-confirmation-cancel"
            >
              {confirmation.cancelLabel}
            </Button>
          )}
          {showOpen && (
            <OpenScheduledLink path={confirmation.scheduledPath}>
              {confirmation.openScheduledLabel}
            </OpenScheduledLink>
          )}
        </div>
      )}
      <ConfirmationDialog
        isOpen={confirmingCancel && cancellable}
        onClose={() => setConfirmingCancel(false)}
        onConfirm={startCancel}
        title={t({
          id: "scheduled.item.cancel.confirmTitle",
          message: `Cancel “${name}”?`,
        })}
        message={t({
          id: "scheduled.item.cancel.confirmMessage",
          message:
            "It will not be carried out. You can still find it under Past.",
        })}
        confirmButtonText={t({
          id: "scheduled.item.cancel.confirm",
          message: "Cancel it",
        })}
        cancelButtonText={t({
          id: "scheduled.item.cancel.keep",
          message: "Keep it",
        })}
        confirmButtonVariant="danger"
      />
    </Card>
  );
}

/**
 * The card for one confirmation, with the reminder's live status and Cancel;
 * in a read-only chat, only what was stored.
 */
export function ReminderConfirmationCard({
  confirmation,
  readOnly = false,
}: {
  confirmation: ReminderConfirmation;
  readOnly?: boolean;
}) {
  return readOnly ? (
    <ReminderConfirmationCardView confirmation={confirmation} readOnly />
  ) : (
    <LiveReminderConfirmationCard confirmation={confirmation} />
  );
}

function LiveReminderConfirmationCard({
  confirmation,
}: {
  confirmation: ReminderConfirmation;
}) {
  const { enabled: scheduledPageEnabled } = useScheduledFeature();
  const { status, isCancelling, cancelError, cancel } = useReminderConfirmation(
    confirmation.itemId,
  );
  return (
    <ReminderConfirmationCardView
      confirmation={confirmation}
      status={status}
      onCancel={cancel}
      isCancelling={isCancelling}
      cancelError={cancelError}
      showOpenScheduled={scheduledPageEnabled}
    />
  );
}
