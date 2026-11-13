import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { Card } from "../Container/Card";
import { Button } from "../Controls/Button";
import { WarningIcon } from "../icons";

import type { AllowOnceEmphasis } from "@/lib/toolCallGist/decision";
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
   * Allow this action and the like ones on the same scope, such as every read
   * of one document, until the scope changes. Omit to hide the button.
   */
  onAllowScope?: () => void;
  allowScopeLabel?: string;
  /** What the scope covers and until when, shown below the buttons. */
  allowScopeHint?: ReactNode;
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
  /**
   * Persist the decision and refuse the action from now on. Omit to hide the
   * button entirely, as `onAlwaysAllow` does.
   */
  onNeverAllow?: () => void;
  allowOnceLabel?: string;
  /**
   * How Allow once looks: `plain` gives it no fill, for a card that asks the
   * person to check something first; `loss` outlines it in red, for a card
   * that states a loss. Defaults to `filled`; it never changes what the
   * button does.
   */
  allowOnceEmphasis?: AllowOnceEmphasis;
  /**
   * Shows Always allow and Never allow as a smaller row under the other
   * buttons, after this label, for standing answers that cover a whole tool.
   */
  standingLabel?: string;
  /**
   * With `standingLabel`: one quiet line under the buttons about the tool. A
   * locked Always allow's reason then belongs in it, and gets no line of its
   * own.
   */
  standingNote?: string;
  alwaysAllowLabel?: string;
  denyLabel?: string;
  neverAllowLabel?: string;
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
   * Progress of the allowed action. While set, the allow button that was
   * pressed shows a spinner with this label and stays focusable instead of
   * disabling, so focus does not drop while the action runs.
   */
  progressLabel?: string;
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
 * Presents the same decision every time, in two pairs: allow once or always
 * allow, deny once or never allow. The "once" answers apply to this proposal
 * and the card asks again next time; the standing answers persist and are
 * omitted by a consumer that cannot store them. A deployment can enforce
 * per-use confirmation, in which case "always allow" renders greyed out with
 * the reason.
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
  onAllowScope,
  allowScopeLabel,
  allowScopeHint,
  onAlwaysAllow,
  alwaysAllowDisabledReason,
  onDeny,
  onNeverAllow,
  allowOnceLabel,
  allowOnceEmphasis = "filled",
  standingLabel,
  standingNote,
  alwaysAllowLabel,
  denyLabel,
  neverAllowLabel,
  status = "pending",
  resolvedLabel,
  isBusy = false,
  progressLabel,
  scrollIntoViewOnMount = false,
  className = "",
  "data-testid": dataTestId,
}) => {
  const cardRef = useRef<HTMLElement | null>(null);
  const alwaysAllowReasonId = useId();
  const allowScopeHintId = useId();
  const lossHintId = useId();
  const standingLabelId = useId();
  const isPending = status === "pending";
  const [allowedWith, setAllowedWith] = useState<"once" | "scope" | "always">(
    "once",
  );
  const onceInProgress = progressLabel !== undefined && allowedWith === "once";
  const scopeInProgress =
    progressLabel !== undefined && allowedWith === "scope";
  const alwaysInProgress =
    progressLabel !== undefined && allowedWith === "always";
  const standing =
    standingLabel !== undefined &&
    (onAlwaysAllow ?? onNeverAllow) !== undefined;
  const reasonLine = standing
    ? (standingNote ?? alwaysAllowDisabledReason)
    : alwaysAllowDisabledReason;

  useEffect(() => {
    if (scrollIntoViewOnMount) {
      cardRef.current?.scrollIntoView({ block: "nearest" });
    }
    if (isPending) {
      // A card mounted already-resolved (e.g. a reloaded transcript) must
      // not grab focus.
      focusIfUnclaimed(cardRef.current);
    }
    // Mount-only by design: re-scrolling on later prop changes would yank
    // the viewport while the user reads or scrolls elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previousStatusRef = useRef(status);
  // Layout effect so focus moves before paint — with a passive effect, focus
  // would sit on <body> for a frame after the button row unmounts before
  // focusIfUnclaimed claims it.
  useLayoutEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;
    if (previousStatus === "pending" && status !== "pending") {
      focusIfUnclaimed(cardRef.current);
    }
  }, [status]);

  const resolvedTitle =
    title ??
    t({
      id: "actionConfirmation.title",
      message: "Allow this action?",
    });

  const resolvedRowLabel =
    resolvedLabel ??
    (status === "confirmed"
      ? t({
          id: "actionConfirmation.confirmed",
          message: "Confirmed",
        })
      : t({
          id: "actionConfirmation.dismissed",
          message: "Dismissed",
        }));

  // Live regions only announce mutations, so the region starts empty and is
  // populated after paint — both the card's appearance and the
  // pending→resolved transition then announce politely (non-modal by
  // design: announce instead of trapping focus). A card mounted
  // already-resolved (e.g. a reloaded transcript) stays silent, otherwise
  // every historical card would queue an announcement.
  const [announcement, setAnnouncement] = useState("");
  const wasPendingAtMountRef = useRef(isPending);
  const announcementText = isPending ? resolvedTitle : resolvedRowLabel;
  useEffect(() => {
    if (wasPendingAtMountRef.current) {
      setAnnouncement(announcementText);
    }
  }, [announcementText]);

  const statesLoss = allowOnceEmphasis === "loss";
  const allowOnceButton = (
    <Button
      variant={allowOnceEmphasis === "filled" ? "primary" : "secondary"}
      size="sm"
      data-emphasis={allowOnceEmphasis}
      // The attribute selector outranks the variant's own border and label
      // colours, which a plain utility would not reliably do. The icon and
      // the description carry the loss for anyone who cannot tell the red.
      className="data-[emphasis=loss]:border-theme-error-fg data-[emphasis=loss]:text-theme-error-fg"
      icon={
        statesLoss && !onceInProgress ? (
          <WarningIcon className="size-4" />
        ) : undefined
      }
      aria-describedby={statesLoss ? lossHintId : undefined}
      onClick={
        onceInProgress
          ? undefined
          : () => {
              setAllowedWith("once");
              onAllowOnce();
            }
      }
      disabled={isBusy && !onceInProgress}
      busy={onceInProgress}
      aria-disabled={onceInProgress || undefined}
    >
      {onceInProgress
        ? progressLabel
        : (allowOnceLabel ??
          t({
            id: "actionConfirmation.allowOnce",
            message: "Allow once",
          }))}
    </Button>
  );

  const allowScopeButton = onAllowScope && (
    <Button
      variant="secondary"
      size="sm"
      onClick={
        scopeInProgress
          ? undefined
          : () => {
              setAllowedWith("scope");
              onAllowScope();
            }
      }
      disabled={isBusy && !scopeInProgress}
      busy={scopeInProgress}
      aria-disabled={scopeInProgress || undefined}
      aria-describedby={allowScopeHint ? allowScopeHintId : undefined}
    >
      {scopeInProgress ? progressLabel : allowScopeLabel}
    </Button>
  );

  // A standing answer is a quieter link in its own row; inline, a button.
  const standingClass = standing ? "underline underline-offset-2" : undefined;

  const alwaysAllowButton = onAlwaysAllow && (
    <Button
      variant={standing ? "link" : "secondary"}
      size="sm"
      // aria-disabled instead of disabled keeps the button in the
      // tab order so keyboard/SR users can discover the option and
      // the reason; the click guard makes it inert.
      onClick={
        alwaysAllowDisabledReason || alwaysInProgress
          ? undefined
          : () => {
              setAllowedWith("always");
              onAlwaysAllow();
            }
      }
      disabled={isBusy && !alwaysInProgress}
      busy={alwaysInProgress}
      aria-disabled={
        alwaysAllowDisabledReason || alwaysInProgress ? true : undefined
      }
      aria-describedby={
        alwaysAllowDisabledReason ? alwaysAllowReasonId : undefined
      }
      className={clsx(
        standingClass,
        alwaysAllowDisabledReason &&
          "aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
      )}
    >
      {alwaysInProgress
        ? progressLabel
        : (alwaysAllowLabel ??
          t({
            id: "actionConfirmation.alwaysAllow",
            message: "Always allow",
          }))}
    </Button>
  );

  const denyButton = (
    <Button variant="secondary" size="sm" onClick={onDeny} disabled={isBusy}>
      {denyLabel ??
        t({
          id: "actionConfirmation.deny",
          message: "Deny once",
        })}
    </Button>
  );

  const neverAllowButton = onNeverAllow && (
    <Button
      variant={standing ? "link" : "secondary"}
      size="sm"
      onClick={onNeverAllow}
      disabled={isBusy}
      className={standingClass}
    >
      {neverAllowLabel ??
        t({
          id: "actionConfirmation.neverAllow",
          message: "Never allow",
        })}
    </Button>
  );

  const lossHint = statesLoss && (
    <span id={lossHintId} className="sr-only">
      {t({
        id: "actionConfirmation.allowOnceLoss",
        message: "This card names something this action may remove or empty.",
      })}
    </span>
  );

  const scopeHint = onAllowScope && allowScopeHint && (
    <div
      id={allowScopeHintId}
      className="space-y-1 text-xs text-theme-fg-muted"
    >
      {allowScopeHint}
    </div>
  );

  return (
    <Card
      ref={cardRef}
      variant="surface"
      size="sm"
      // Programmatic focus target so keyboard focus never drops to <body>
      // when the trigger disables on open or the button row unmounts.
      tabIndex={-1}
      role={isPending ? "group" : undefined}
      aria-label={isPending ? resolvedTitle : undefined}
      className={`focus-ring-tight ${standing ? "mt-4" : "mt-2"} min-w-0 ${className}`}
      bodyClassName={
        isPending
          ? standing
            ? "space-y-2"
            : "space-y-3"
          : "text-xs text-theme-fg-muted"
      }
      data-testid={dataTestId}
      data-layout={standing ? "standing" : undefined}
    >
      {isPending ? (
        <>
          <p
            className={clsx(
              "text-sm text-theme-fg-primary",
              standing ? "font-semibold" : "font-medium",
            )}
            data-testid="action-confirmation-question"
          >
            {resolvedTitle}
          </p>
          {typeof description === "string" ? (
            <p className="text-sm text-theme-fg-secondary">{description}</p>
          ) : (
            description
          )}
          {lossHint}
          {standing ? (
            <>
              <div className="flex flex-wrap gap-2">
                {allowOnceButton}
                {allowScopeButton}
                {denyButton}
              </div>
              {scopeHint}
              {/* A group named by its scope word, so a screen reader says
                  whose standing answer each one is. */}
              <div
                role="group"
                aria-labelledby={standingLabelId}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-theme-fg-secondary"
                data-testid="action-confirmation-standing"
              >
                <span id={standingLabelId}>{standingLabel}</span>
                {alwaysAllowButton}
                {alwaysAllowButton && neverAllowButton && (
                  <span aria-hidden="true" className="text-theme-fg-muted">
                    ·
                  </span>
                )}
                {neverAllowButton}
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {allowOnceButton}
                {allowScopeButton}
                {alwaysAllowButton}
                {denyButton}
                {neverAllowButton}
              </div>
              {scopeHint}
            </>
          )}
          {reasonLine && (
            <p
              id={alwaysAllowReasonId}
              className="text-xs text-theme-fg-muted"
              data-testid="action-confirmation-tool-facts"
            >
              {reasonLine}
            </p>
          )}
        </>
      ) : (
        resolvedRowLabel
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </Card>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
ActionConfirmationCard.displayName = "ActionConfirmationCard";
