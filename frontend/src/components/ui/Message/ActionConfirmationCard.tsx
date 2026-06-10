import { t } from "@lingui/core/macro";
import { useEffect, useRef } from "react";

import { Button } from "../Controls/Button";

import type React from "react";
import type { ReactNode } from "react";

export type ActionConfirmationStatus = "pending" | "confirmed" | "dismissed";

interface ActionConfirmationCardProps {
  /** Short question, e.g. "Reply to all recipients?" */
  title: string;
  /**
   * Explanatory body; string or rich node (e.g. a recipient list). Strings
   * get default secondary-text styling, nodes render as-is.
   */
  description?: ReactNode;
  /** Label for the confirm button. */
  confirmLabel?: string;
  /** Label for the dismiss button. */
  dismissLabel?: string;
  onConfirm: () => void;
  onDismiss: () => void;
  /**
   * Lifecycle state. `pending` renders the confirm/dismiss buttons;
   * `confirmed` / `dismissed` render a compact resolved row so the decision
   * stays visible in the transcript.
   */
  status?: ActionConfirmationStatus;
  /** Text for the resolved row (e.g. "Reply opened"). */
  resolvedLabel?: string;
  /** Disables the buttons while the confirmed action is executing. */
  isBusy?: boolean;
  /**
   * Scroll the card into view when it mounts. Used when the card is
   * surfaced by the application (e.g. after a fresh assistant completion)
   * rather than by a user click, so it can't appear off-screen unnoticed.
   */
  scrollIntoViewOnMount?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Test ID for e2e testing */
  "data-testid"?: string;
}

/**
 * Inline, message-scoped confirmation step for an assistant-proposed action.
 *
 * Unlike a modal, the card lives WITH the proposal in the conversation: it
 * never steals focus, multiple proposals can be pending independently, and a
 * resolved card stays visible as a record of the decision. The component is
 * deliberately execution-agnostic — `onConfirm` may run a client-side action
 * (e.g. the Outlook add-in opening a reply form) or call an approval endpoint
 * for server-gated tools; the card only renders the decision step.
 */
export const ActionConfirmationCard: React.FC<ActionConfirmationCardProps> = ({
  title,
  description,
  confirmLabel,
  dismissLabel,
  onConfirm,
  onDismiss,
  status = "pending",
  resolvedLabel,
  isBusy = false,
  scrollIntoViewOnMount = false,
  className = "",
  "data-testid": dataTestId,
}) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollIntoViewOnMount) {
      cardRef.current?.scrollIntoView({ block: "nearest" });
    }
    // Mount-only by design: re-scrolling on later prop changes would yank
    // the viewport while the user reads or scrolls elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status !== "pending") {
    return (
      <div
        ref={cardRef}
        className={`mt-2 rounded-md border border-theme-border bg-theme-bg-primary px-3 py-2 text-xs text-theme-fg-muted ${className}`}
        data-testid={dataTestId}
      >
        {resolvedLabel ??
          (status === "confirmed"
            ? t`Confirmed`
            : t({
                id: "actionConfirmation.dismissed",
                message: "Dismissed",
              }))}
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      // Non-modal by design: announce politely instead of trapping focus.
      role="group"
      aria-live="polite"
      aria-label={title}
      className={`mt-2 space-y-2 rounded-md border border-theme-border bg-theme-bg-primary p-3 ${className}`}
      data-testid={dataTestId}
    >
      <p className="text-sm font-medium text-theme-fg-primary">{title}</p>
      {typeof description === "string" ? (
        <p className="text-sm text-theme-fg-secondary">{description}</p>
      ) : (
        description
      )}
      <div className="flex gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={onConfirm}
          disabled={isBusy}
        >
          {confirmLabel ?? t`Confirm`}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onDismiss}
          disabled={isBusy}
        >
          {dismissLabel ?? t`Cancel`}
        </Button>
      </div>
    </div>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
ActionConfirmationCard.displayName = "ActionConfirmationCard";
