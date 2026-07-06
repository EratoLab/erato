import { t } from "@lingui/core/macro";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "../Controls/Button";

import type React from "react";
import type { ReactNode } from "react";

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
 * Focus the card only when focus would otherwise be lost to <body> — the
 * consumer disables its trigger while a card is pending, and the button row
 * unmounts on resolution. Never steals focus from an unrelated element.
 */
const focusIfUnclaimed = (card: HTMLElement | null) => {
  if (!card) {
    return;
  }
  const active = document.activeElement;
  if (active === null || active === document.body || card.contains(active)) {
    // preventScroll keeps scrolling governed solely by scrollIntoViewOnMount.
    card.focus({ preventScroll: true });
  }
};

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
 * never steals focus and multiple proposals can be pending independently. The
 * component is deliberately execution-agnostic — the callbacks may run a
 * client-side action or call an approval endpoint for server-gated tools; the
 * card only renders the decision step.
 *
 * The resolved-row persistent record (status / resolvedLabel props) was
 * removed in 2026-07: callers now close the card on resolution and show
 * transient button feedback (e.g. "Opened!") using `useTransientLabel`.
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
  isBusy = false,
  scrollIntoViewOnMount = false,
  className = "",
  "data-testid": dataTestId,
}) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const alwaysAllowReasonId = useId();

  useEffect(() => {
    if (scrollIntoViewOnMount) {
      cardRef.current?.scrollIntoView({ block: "nearest" });
    }
    focusIfUnclaimed(cardRef.current);
    // Mount-only by design: re-scrolling on later prop changes would yank
    // the viewport while the user reads or scrolls elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cardTitle =
    title ??
    t({
      id: "actionConfirmation.title",
      message: "Allow this action?",
    });

  // Live regions only announce mutations, so the region starts empty and is
  // populated after paint — the card's appearance then announces politely
  // (non-modal by design: announce instead of trapping focus).
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    setAnnouncement(cardTitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={cardRef}
      // Programmatic focus target so keyboard focus never drops to <body>
      // when the trigger disables on open.
      tabIndex={-1}
      role="group"
      aria-label={cardTitle}
      className={`mt-2 space-y-2 rounded-md border border-theme-border bg-theme-bg-primary p-3 ${className}`}
      data-testid={dataTestId}
    >
      <p className="text-sm font-medium text-theme-fg-primary">{cardTitle}</p>
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
            // aria-disabled instead of disabled keeps the button in the
            // tab order so keyboard/SR users can discover the option and
            // the reason; the click guard makes it inert.
            onClick={alwaysAllowDisabledReason ? undefined : onAlwaysAllow}
            disabled={isBusy}
            aria-disabled={alwaysAllowDisabledReason ? true : undefined}
            aria-describedby={
              alwaysAllowDisabledReason ? alwaysAllowReasonId : undefined
            }
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          >
            {alwaysAllowLabel ??
              t({
                id: "actionConfirmation.alwaysAllow",
                message: "Always allow",
              })}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={onDeny}
          disabled={isBusy}
        >
          {denyLabel ??
            t({
              id: "actionConfirmation.deny",
              message: "Deny",
            })}
        </Button>
      </div>
      {alwaysAllowDisabledReason && (
        <p id={alwaysAllowReasonId} className="text-xs text-theme-fg-muted">
          {alwaysAllowDisabledReason}
        </p>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
ActionConfirmationCard.displayName = "ActionConfirmationCard";
