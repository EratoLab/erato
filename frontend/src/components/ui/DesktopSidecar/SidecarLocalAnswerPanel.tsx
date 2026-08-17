import { t } from "@lingui/core/macro";
import { useEffect } from "react";

import { Alert } from "@/components/ui/Feedback/Alert";
import { usePersistedState } from "@/hooks/usePersistedState";
import {
  NEW_CHAT_LOCAL_ANSWER_KEY,
  SIDECAR_LOCAL_ANSWERS_KEY,
  dismissSidecarLocalAnswer,
  rekeySidecarLocalAnswers,
  sidecarLocalAnswersForChat,
  sidecarLocalAnswersPersistedOptions,
  type SidecarLocalAnswer,
} from "@/lib/desktopSidecar/localAnswers";

const DEFAULT_ANSWERS: SidecarLocalAnswer[] = [];

export interface SidecarLocalAnswerPanelProps {
  /** Chat whose declined answers to show. */
  chatId: string | null;
}

/**
 * Answers the device produced and the user declined to share.
 *
 * Deliberately NOT part of the message transcript: it is rendered as a
 * distinct notice outside the message list, because the server-side history
 * truthfully records only the decline. That split is the privacy property
 * made visible — the answer exists only here, on the device that made it.
 */
export const SidecarLocalAnswerPanel = ({
  chatId,
}: SidecarLocalAnswerPanelProps) => {
  const [answers, setAnswers] = usePersistedState<SidecarLocalAnswer[]>(
    SIDECAR_LOCAL_ANSWERS_KEY,
    DEFAULT_ANSWERS,
    sidecarLocalAnswersPersistedOptions,
  );

  // A decline can happen before a brand-new chat has its server id; adopt the
  // real id as soon as it exists so the entry stays with its conversation.
  useEffect(() => {
    if (chatId === null) {
      return;
    }
    setAnswers((previous) =>
      previous.some((entry) => entry.chatKey === NEW_CHAT_LOCAL_ANSWER_KEY)
        ? rekeySidecarLocalAnswers(previous, chatId)
        : previous,
    );
  }, [chatId, setAnswers]);

  const visible = sidecarLocalAnswersForChat(
    answers,
    chatId ?? NEW_CHAT_LOCAL_ANSWER_KEY,
  );
  if (visible.length === 0) {
    return null;
  }

  return (
    <div
      className="mx-auto w-full max-w-[var(--theme-layout-chat-input-max-width)] space-y-2 px-2 pt-2 sm:px-4"
      data-testid="sidecar-local-answer-panel"
    >
      {visible.map((answer) => {
        const model = answer.summaryModel;
        const query = answer.query;
        return (
          <Alert
            key={answer.id}
            type="info"
            className="border-dashed"
            title={t`Answer from this device`}
            dismissible
            onDismiss={() =>
              setAnswers((previous) =>
                dismissSidecarLocalAnswer(previous, answer.id),
              )
            }
            data-testid="sidecar-local-answer"
          >
            <div className="space-y-1 text-sm">
              <p className="text-xs font-medium">
                {model !== undefined
                  ? t`Generated on this device by ${model}. It was not shared — it never left this device and is not part of the chat.`
                  : t`Generated on this device. It was not shared — it never left this device and is not part of the chat.`}
              </p>
              <p className="text-xs text-theme-fg-muted">
                {t`You asked: ${query}`}
              </p>
              <p className="whitespace-pre-wrap">{answer.summary}</p>
              {answer.hitLines.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-theme-fg-muted">
                  {answer.hitLines.map((line) => (
                    // Sender addresses can be long unbroken strings (Exchange
                    // system senders); wrap them instead of overflowing.
                    <li key={line} className="break-words">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Alert>
        );
      })}
    </div>
  );
};
