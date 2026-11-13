import { t } from "@lingui/core/macro";
import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  MESSAGE_EXPLAIN_MAX_FOLLOW_UPS,
  isMessageExplainBusy,
  messageExplainFollowUpCount,
  takeMessageExplainFocusRequest,
  useMessageExplainStore,
  type MessageExplainCardState,
  type MessageExplainTurnState,
} from "@/hooks/chat/store/messageExplainStore";
import { isImeComposing } from "@/utils/isImeComposing";

import {
  MESSAGE_CONTENT_DATA_UI,
  MESSAGE_EXPLAIN_DATA_UI,
} from "./messageTextBlocks";
import { Card } from "../Container/Card";
import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";
import { LoadingIndicator } from "../Feedback/LoadingIndicator";
import { StatusPill } from "../Feedback/StatusPill";
import { Input } from "../Input/Input";
import { ArrowUpIcon, ChatBubbleQuestionIcon, CloseIcon } from "../icons";

const FOLLOW_UP_MAX_LENGTH = 4000;
const PASSAGE_LABEL_LENGTH = 80;
/** Distance from the end within which new text keeps the turns scrolled down. */
const STICK_TO_END_PX = 48;

/**
 * Draws an answer. `MessageContent` passes itself in: it renders this card, so
 * an import in the other direction would be a cycle.
 */
export type RenderExplainAnswer = (
  text: string,
  isStreaming: boolean,
) => ReactNode;

export interface MessageExplainCardViewProps {
  card: MessageExplainCardState;
  renderAnswer: RenderExplainAnswer;
  onAsk: (question: string) => void;
  onRetry: () => void;
  onClose: () => void;
  /**
   * Asked once on mount; true when the card was just opened, so it takes
   * focus and scrolls into view. A row remounted by scrolling answers false.
   */
  shouldFocusOnMount?: () => boolean;
  className?: string;
}

function ExplainTurn({
  turn,
  isFirst,
  renderAnswer,
  onRetry,
}: {
  turn: MessageExplainTurnState;
  isFirst: boolean;
  renderAnswer: RenderExplainAnswer;
  onRetry: () => void;
}) {
  return (
    <div
      data-ui="message-explain-turn"
      className={clsx(
        !isFirst && "mt-3 border-t border-[var(--theme-border-subtle)] pt-3",
      )}
    >
      {turn.question !== null && (
        <p
          data-ui="message-explain-question"
          className="mb-1 break-words text-sm font-medium text-theme-fg-secondary"
        >
          {turn.question}
        </p>
      )}
      {turn.status === "loading" ? (
        <LoadingIndicator state="thinking" />
      ) : (
        turn.answer !== "" &&
        renderAnswer(turn.answer, turn.status === "streaming")
      )}
      {turn.status === "error" && (
        <Alert
          type="error"
          className={clsx(turn.answer !== "" && "mt-3")}
          action={
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {t({
                id: "messageTextActions.explain.retry",
                message: "Try again",
              })}
            </Button>
          }
        >
          {turn.question === null
            ? t({
                id: "messageTextActions.explain.error",
                message: "The explanation could not be loaded.",
              })
            : t({
                id: "messageTextActions.explain.followUpError",
                message: "The answer could not be loaded.",
              })}
        </Alert>
      )}
    </div>
  );
}

/**
 * The small chat that explains a marked passage. It is an aside, not part of
 * the conversation: the frame and the "Not saved" pill say so.
 */
export function MessageExplainCardView({
  card,
  renderAnswer,
  onAsk,
  onRetry,
  onClose,
  shouldFocusOnMount,
  className,
}: MessageExplainCardViewProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const turnsRef = useRef<HTMLDivElement | null>(null);
  const sticksToEndRef = useRef(true);
  const [draft, setDraft] = useState("");

  const lastTurn = card.turns.at(-1);
  const isBusy = isMessageExplainBusy(card);
  const hasFailed = lastTurn?.status === "error";
  const limitReached =
    messageExplainFollowUpCount(card) >= MESSAGE_EXPLAIN_MAX_FOLLOW_UPS;
  const fieldDisabled = hasFailed || limitReached;
  const canSend = !isBusy && !fieldDisabled && draft.trim() !== "";

  useEffect(() => {
    if (shouldFocusOnMount?.()) {
      cardRef.current?.scrollIntoView({ block: "nearest" });
      inputRef.current?.focus({ preventScroll: true });
    }
    // Mount-only: a later prop change must not pull focus or the viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const scroller = turnsRef.current?.parentElement;
    if (!scroller) {
      return;
    }
    const onScroll = () => {
      sticksToEndRef.current =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <
        STICK_TO_END_PX;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const scroller = turnsRef.current?.parentElement;
    if (scroller && sticksToEndRef.current) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [card.turns]);

  const close = useCallback(() => {
    const element = cardRef.current;
    const hadFocus = !!element?.contains(document.activeElement);
    const messageText = element?.closest<HTMLElement>(
      `[data-ui="${MESSAGE_CONTENT_DATA_UI}"]`,
    );
    onClose();
    // Focus would drop to the body with the card. The text of the message is
    // where the user came from, and it only takes focus for this one return.
    if (hadFocus && messageText) {
      messageText.tabIndex = -1;
      messageText.addEventListener(
        "blur",
        () => messageText.removeAttribute("tabindex"),
        { once: true },
      );
      messageText.focus({ preventScroll: true });
    }
  }, [onClose]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSend) {
      return;
    }
    sticksToEndRef.current = true;
    onAsk(draft);
    setDraft("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !isImeComposing(event.nativeEvent)) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  const title = t({
    id: "messageTextActions.explain.title",
    message: "Explain",
  });
  const passageLabel =
    card.passage.length > PASSAGE_LABEL_LENGTH
      ? `${card.passage.slice(0, PASSAGE_LABEL_LENGTH)}…`
      : card.passage;
  const followUpLabel = limitReached
    ? t({
        id: "messageTextActions.explain.followUpLimit",
        message: "No more follow-up questions here",
      })
    : t({
        id: "messageTextActions.explain.followUpPlaceholder",
        message: "Ask a follow-up question",
      });

  return (
    <Card
      ref={cardRef}
      variant="surface"
      size="sm"
      role="group"
      aria-label={`${title}: ${passageLabel}`}
      data-ui={MESSAGE_EXPLAIN_DATA_UI}
      className={clsx("mb-4 min-w-0 last:mb-0", className)}
      bodyClassName="max-h-80 overflow-y-auto"
      onKeyDown={handleKeyDown}
      header={
        // The band has no inset of its own, and Card's action slot has none
        // either, so the close button sits inside the band's padding.
        <div className="flex flex-wrap items-center gap-2 border-b border-theme-border p-3 text-theme-fg-secondary">
          <ChatBubbleQuestionIcon className="size-4 shrink-0" aria-hidden />
          <span className="text-sm font-medium text-theme-fg-primary">
            {title}
          </span>
          <StatusPill tone="muted">
            {t({
              id: "messageTextActions.explain.notSaved",
              message: "Not saved",
            })}
          </StatusPill>
          <Button
            variant="icon-only"
            className="ml-auto"
            icon={<CloseIcon className="size-5" />}
            aria-label={t({
              id: "messageTextActions.explain.close",
              message: "Close",
            })}
            onClick={close}
          />
        </div>
      }
      footer={
        <form
          className="flex items-center gap-2 border-t border-theme-border p-3"
          onSubmit={handleSubmit}
        >
          <Input
            ref={inputRef}
            geometry="control"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={followUpLabel}
            aria-label={followUpLabel}
            disabled={fieldDisabled}
            maxLength={FOLLOW_UP_MAX_LENGTH}
            autoComplete="off"
          />
          <Button
            type="submit"
            variant="icon-only"
            icon={<ArrowUpIcon className="size-5" />}
            aria-label={t({
              id: "messageTextActions.explain.send",
              message: "Send",
            })}
            disabled={!canSend}
          />
        </form>
      }
    >
      <div ref={turnsRef}>
        {card.turns.map((turn, index) => (
          <ExplainTurn
            key={turn.id}
            turn={turn}
            isFirst={index === 0}
            renderAnswer={renderAnswer}
            onRetry={onRetry}
          />
        ))}
      </div>
    </Card>
  );
}

/** The open small chat of `messageId`, from the client store; else nothing. */
export function MessageExplainCard({
  messageId,
  renderAnswer,
}: {
  messageId: string;
  renderAnswer: RenderExplainAnswer;
}) {
  const card = useMessageExplainStore((state) =>
    state.card?.messageId === messageId ? state.card : null,
  );
  const ask = useMessageExplainStore((state) => state.ask);
  const retry = useMessageExplainStore((state) => state.retry);
  const close = useMessageExplainStore((state) => state.close);
  if (!card) {
    return null;
  }
  return (
    <MessageExplainCardView
      card={card}
      renderAnswer={renderAnswer}
      onAsk={ask}
      onRetry={retry}
      onClose={close}
      shouldFocusOnMount={takeMessageExplainFocusRequest}
    />
  );
}
