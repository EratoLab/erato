import { t } from "@lingui/core/macro";
import { useNavigate } from "react-router-dom";

import { delegatedRunOrigin } from "@/utils/chat/delegatedRunOrigin";
import { getChatUrl } from "@/utils/chat/urlUtils";

import type { DelegatedRunProvenance } from "@/utils/chat/delegatedRunOrigin";

export interface DelegatedRunHeaderProps extends DelegatedRunProvenance {
  /** The delegate this run was handed to. */
  assistantName?: string;
  /** The result shape the dispatching model asked for. */
  expectedOutput?: string;
  /** The limits the delegate was told to work within. */
  constraints?: string;
  /** The delegate is still working; the run cannot take a message yet. */
  isRunning?: boolean;
  /** Archived, possibly by the cascade from the chat that dispatched it. */
  isArchived?: boolean;
  /**
   * Opens the origin chat in the host's own way. Left unset, the origin
   * renders as a link to its chat route; a host without those routes
   * supplies this and the origin becomes a button.
   */
  onOpenOrigin?: (chatId: string) => void;
}

// dt/dd as flat grid children, so the label column sizes to the widest
// label instead of a fixed width that clips longer translations.
const Field = ({ label, value }: { label: string; value: string }) => (
  <>
    <dt className="text-theme-fg-muted">{label}</dt>
    <dd className="min-w-0 whitespace-pre-wrap text-theme-fg-secondary">
      {value}
    </dd>
  </>
);

/**
 * States the run header explains rather than letting the user discover them
 * by writing a message and getting a 409 back.
 */
const stateNote = (
  isRunning: boolean,
  isArchived: boolean,
): string | undefined => {
  if (isRunning) {
    return t({
      id: "chat.delegatedRun.state.running",
      message: "The delegate is still working on this run.",
    });
  }
  if (isArchived) {
    return t({
      id: "chat.delegatedRun.state.archived",
      message: "This run is archived and no longer takes messages.",
    });
  }
  return undefined;
};

/**
 * Says what a delegated chat is, at the top of the chat itself.
 *
 * A run opens on a brief a model wrote for another model, which reads as a
 * user message that the user never typed. The header carries the provenance
 * and the parameters the run was dispatched with; the brief stays the first
 * message, because it is one. The run-behaviour boilerplate the delegate was
 * given is deliberately not shown — no person needs it.
 */
export const DelegatedRunHeader = ({
  assistantName,
  expectedOutput,
  constraints,
  isRunning = false,
  isArchived = false,
  onOpenOrigin,
  ...provenance
}: DelegatedRunHeaderProps) => {
  const navigate = useNavigate();
  const origin = delegatedRunOrigin(provenance);
  if (!origin) {
    return null;
  }
  const originChatId = origin.chatId;
  const note = stateNote(isRunning, isArchived);
  const hasParameters = Boolean(expectedOutput) || Boolean(constraints);
  const originHref = origin.chatId
    ? getChatUrl(origin.chatId, origin.assistantId)
    : null;

  return (
    <div
      className="min-w-0 space-y-1.5 text-xs"
      data-testid="delegated-run-header"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="font-medium text-theme-fg-primary">
          {t({ id: "chat.delegatedRun.title", message: "Delegated run" })}
        </span>
        {assistantName ? (
          <>
            <span aria-hidden="true" className="text-theme-fg-muted">
              ·
            </span>
            <span className="truncate text-theme-fg-secondary">
              {assistantName}
            </span>
          </>
        ) : null}
        <span aria-hidden="true" className="text-theme-fg-muted">
          ·
        </span>
        {originChatId && originHref ? (
          onOpenOrigin ? (
            <button
              type="button"
              onClick={() => onOpenOrigin(originChatId)}
              className="focus-ring-tight truncate rounded-[var(--theme-radius-base)] text-theme-fg-secondary underline underline-offset-2 hover:text-theme-fg-primary"
              data-testid="delegated-run-origin-link"
            >
              {origin.label}
            </button>
          ) : (
            <a
              href={originHref}
              onClick={(e) => {
                // Allow cmd/ctrl-click to open in new tab
                if (e.metaKey || e.ctrlKey) {
                  return;
                }
                e.preventDefault();
                navigate(originHref);
              }}
              // Persistent underline on purpose: a link sitting mid-sentence
              // needs a resting affordance, like the prose links in message
              // content — unlike hover-underlined control-style links.
              className="focus-ring-tight truncate rounded-[var(--theme-radius-base)] text-theme-fg-secondary underline underline-offset-2 hover:text-theme-fg-primary"
              data-testid="delegated-run-origin-link"
            >
              {origin.label}
            </a>
          )
        ) : (
          <span
            className="truncate text-theme-fg-muted"
            data-testid="delegated-run-origin"
          >
            {origin.label}
          </span>
        )}
      </div>
      {hasParameters ? (
        <dl className="grid min-w-0 grid-cols-1 gap-y-0.5 sm:grid-cols-[auto,1fr] sm:gap-x-3 sm:gap-y-1">
          {expectedOutput ? (
            <Field
              label={t({
                id: "chat.delegatedRun.expectedOutput",
                message: "Expected output",
              })}
              value={expectedOutput}
            />
          ) : null}
          {constraints ? (
            <Field
              label={t({
                id: "chat.delegatedRun.constraints",
                message: "Constraints",
              })}
              value={constraints}
            />
          ) : null}
        </dl>
      ) : null}
      {note ? (
        <p className="text-theme-fg-muted" data-testid="delegated-run-state">
          {note}
        </p>
      ) : null}
    </div>
  );
};
