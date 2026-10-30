import { t } from "@lingui/core/macro";

import { Button } from "@/components/ui/Controls/Button";
import { OpenNewWindowIcon } from "@/components/ui/icons";
import { useDelegatedRunRetry } from "@/hooks/chat/useDelegatedRunRetry";
import { useDelegatedRunOpener } from "@/providers/DelegatedRunOpenProvider";
import { getChatUrl } from "@/utils/chat/urlUtils";

/**
 * The delegate's answer is quoted, not reproduced — the run itself is a click
 * away.
 */
const RESULT_PREVIEW_CHARS = 280;

export const resultPreview = (
  result: string | undefined,
): string | undefined => {
  const text = result?.trim();
  if (!text) {
    return undefined;
  }
  const characters = [...text];
  return characters.length > RESULT_PREVIEW_CHARS
    ? `${characters.slice(0, RESULT_PREVIEW_CHARS).join("")}…`
    : text;
};

const OPEN_RUN_CLASS =
  "focus-ring-tight inline-flex size-5 shrink-0 items-center justify-center rounded-[var(--theme-radius-base)] text-theme-fg-muted hover:text-theme-fg-primary";

export const OpenDelegatedRunLink = ({
  chatId,
  assistantId,
  label,
  testId,
}: {
  chatId: string;
  assistantId?: string;
  label: string;
  testId: string;
}) => {
  const openRun = useDelegatedRunOpener();
  if (openRun) {
    return (
      <button
        type="button"
        onClick={() => openRun(chatId)}
        aria-label={label}
        title={label}
        data-testid={testId}
        className={OPEN_RUN_CLASS}
      >
        <OpenNewWindowIcon className="size-3.5" />
      </button>
    );
  }
  return (
    <a
      href={getChatUrl(chatId, assistantId)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      data-testid={testId}
      className={OPEN_RUN_CLASS}
    >
      <OpenNewWindowIcon className="size-3.5" />
    </a>
  );
};

/**
 * Offer to run a failed task again.
 *
 * Mounted only where a run failed: the hook needs a feature-config provider
 * and a query client, which a step for a successful run must not start owing.
 * The copy states the retry's shape because the step it sits in is never
 * rewritten — the retry's answer arrives as a result of its own.
 */
export const RetryTaskControl = ({
  childChatId,
  testIdPrefix,
}: {
  childChatId: string;
  testIdPrefix: string;
}) => {
  const { enabled, retriedByChatId, isRetrying, refusal, retry } =
    useDelegatedRunRetry(childChatId);

  if (!enabled) {
    return null;
  }

  if (retriedByChatId !== undefined) {
    return (
      <p data-testid={`${testIdPrefix}-retried`}>
        {t({
          id: "trace.delegation.retried",
          message: "Retried as a background task.",
        })}
      </p>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-x-2"
      data-testid={`${testIdPrefix}-retry`}
    >
      <Button
        variant="link"
        size="sm"
        loading={isRetrying}
        onClick={retry}
        // eslint-disable-next-line lingui/no-unlocalized-strings -- test id
        data-testid={`${testIdPrefix}-retry-action`}
      >
        {t({ id: "trace.delegation.retry", message: "Retry task" })}
      </Button>
      <span>
        {t({
          id: "trace.delegation.retry.background",
          message:
            "The retry runs as a background task; its answer arrives separately, not in this step.",
        })}
      </span>
      {refusal !== null && (
        <span data-testid={`${testIdPrefix}-retry-refused`}>
          {t({
            id: "trace.delegation.retry.failed",
            message: "This task cannot be retried",
          })}
        </span>
      )}
    </div>
  );
};
