import { t } from "@lingui/core/macro";
import { useLayoutEffect, useRef } from "react";
import { Link, useInRouterContext } from "react-router-dom";

import { useReminderConfirmation } from "@/hooks/scheduled/useReminderConfirmation";
import { getClientPlatform } from "@/lib/clientPlatform";
import { useScheduledFeature } from "@/providers/FeatureConfigProvider";

import { ScheduledStatusPill } from "./ScheduledStatusPill";
import { Card } from "../Container/Card";
import { Button, controlSurfaceClassName } from "../Controls/Button";

import type { ReminderConfirmation } from "./reminderConfirmation";
import type { ReminderConfirmationStatus } from "@/hooks/scheduled/useReminderConfirmation";
import type { ReactNode } from "react";

export interface ReminderConfirmationCardViewProps {
  confirmation: ReminderConfirmation;
  /** What became of the reminder; unknown while it loads or cannot be read. */
  status?: ReminderConfirmationStatus;
  onCancel: () => void;
  isCancelling?: boolean;
  /** Why Cancel was refused. */
  cancelError?: string | null;
  /** Off where the app has no Scheduled page. */
  showOpenScheduled?: boolean;
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
}: ReminderConfirmationCardViewProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  const cancellable =
    status === undefined || status === "scheduled" || status === "snoozed";

  // Cancel unmounts once it worked; focus would otherwise drop to <body>.
  const wasCancellable = useRef(cancellable);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (wasCancellable.current && !cancellable && card) {
      const active = document.activeElement;
      if (active === null || active === document.body) {
        card.focus({ preventScroll: true });
      }
    }
    wasCancellable.current = cancellable;
  }, [cancellable]);

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
      {(cancellable || showOpenScheduled) && (
        <div className="flex flex-wrap gap-2">
          {cancellable && (
            <Button
              variant="secondary"
              size="sm"
              onClick={isCancelling ? undefined : onCancel}
              busy={isCancelling}
              data-testid="reminder-confirmation-cancel"
            >
              {confirmation.cancelLabel}
            </Button>
          )}
          {showOpenScheduled && (
            <OpenScheduledLink path={confirmation.scheduledPath}>
              {confirmation.openScheduledLabel}
            </OpenScheduledLink>
          )}
        </div>
      )}
    </Card>
  );
}

/** The card for one confirmation, with the reminder's live status and Cancel. */
export function ReminderConfirmationCard({
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
