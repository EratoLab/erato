import { t } from "@lingui/core/macro";
import { useEffect, useRef } from "react";

import { Button } from "../Controls/Button";

import type React from "react";
import type { ReactNode } from "react";

export type ActionConfirmationStatus = "pending" | "confirmed" | "dismissed";

interface ActionConfirmationCardProps {
  /**
   * Title of the permission step. Defaults to a generic "Allow this action?"
   * so every consumer presents the same recognizable frame; the
   * action-specific information belongs in `description`.
   */
  title?: string;
  /**
   * What the assistant wants to do and its consequences (e.g. the action
   * label and a recipient list). Strings get default secondary-text styling,
   * nodes render as-is.
   */
  description?: ReactNode;
  /** Allow the action this one time; the card will ask again next time. */
  onAllowOnce: () => void;
  /**
   * Persist the decision and allow the action. Omit to hide the button
   * entirely (e.g. the consumer has no persistence).
   */
  onAlwaysAllow?: () => void;
  /**
   * When set, "Always allow" renders disabled with this reason below the
   * buttons — used when a deployment enforces per-use confirmation. Only
   * meaningful together with `onAlwaysAllow`.
   */
  alwaysAllowDisabledReason?: string;
  /** Skip the action this one time; the card will ask again next time. */
  onDeny: () => void;
  allowOnceLabel?: string;
  alwaysAllowLabel?: string;
  denyLabel?: string;
  /**
   * Lifecycle state. `pending` renders the decision buttons;
   * `confirmed` / `dismissed` render a compact resolved row so the decision
   * stays visible in the transcript.
   */
  status?: ActionConfirmationStatus;
  /** Text for the resolved row (e.g. "Reply opened"). */
  resolvedLabel?: string;
  /** Disables the buttons while the allowed action is executing. */
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
 * Inline, message-scoped permission step for an assistant-proposed action.
 *
 * Presents the same three-way decision every time — allow once, always
 * allow, deny — with browser-permission semantics: only "always allow"
 * persists; "allow once" and "deny" apply to this proposal and the card asks
 * again next time. A deployment can enforce per-use confirmation, in which
 * case "always allow" renders greyed out with the reason.
 *
 * Unlike a modal, the card lives WITH the proposal in the conversation: it
 * never steals focus, multiple proposals can be pending independently, and a
 * resolved card stays visible as a record of the decision. The component is
 * deliberately execution-agnostic — the callbacks may run a client-side
 * action (e.g. the Outlook add-in opening a reply form) or call an approval
 * endpoint for server-gated tools; the card only renders the decision step.
 */
export const ActionConfirmationCard: React.FC<ActionConfirmationCardProps> = ({
  title,
  description,
  onAllowOnce,
  onAlwaysAllow,
  alwaysAllowDisabledReason,
  onDeny,
  allowOnceLabel,
  alwaysAllowLabel,
  denyLabel,
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

  const resolvedTitle =
    title ??
    t({
      id: "actionConfirmation.title",
      message: "Allow this action?",
    });

  return (
    <div
      ref={cardRef}
      // Non-modal by design: announce politely instead of trapping focus.
      role="group"
      aria-live="polite"
      aria-label={resolvedTitle}
      className={`mt-2 space-y-2 rounded-md border border-theme-border bg-theme-bg-primary p-3 ${className}`}
      data-testid={dataTestId}
    >
      <p className="text-sm font-medium text-theme-fg-primary">
        {resolvedTitle}
      </p>
      {typeof description === "string" ? (
        <p className="text-sm text-theme-fg-secondary">{description}</p>
      ) : (
        description
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={onAllowOnce}
          disabled={isBusy}
        >
          {allowOnceLabel ??
            t({
              id: "actionConfirmation.allowOnce",
              message: "Allow once",
            })}
        </Button>
        {onAlwaysAllow && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onAlwaysAllow}
            disabled={isBusy || !!alwaysAllowDisabledReason}
          >
            {alwaysAllowLabel ??
              t({
                id: "actionConfirmation.alwaysAllow",
                message: "Always allow",
              })}
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={onDeny} disabled={isBusy}>
          {denyLabel ??
            t({
              id: "actionConfirmation.deny",
              message: "Deny",
            })}
        </Button>
      </div>
      {alwaysAllowDisabledReason && (
        <p className="text-xs text-theme-fg-muted">
          {alwaysAllowDisabledReason}
        </p>
      )}
    </div>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
ActionConfirmationCard.displayName = "ActionConfirmationCard";
