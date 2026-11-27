import { useMemo, useRef } from "react";

import { taskResultOf } from "@/utils/chat/taskResultFolds";

import type { ChatMessage } from "@/components/ui/MessageList/MessageList";
import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const WRITTEN_START_ATTRIBUTE = "data-written-start";

/** On an approval card while it waits for the person's decision. */
const WAITING_CARD_ATTRIBUTE = "data-waiting-card";

/** Room left around what the view keeps in view. */
export const CONVERSATION_MARGIN_PX = 16;

const followsWrittenAnswer = new Set<ContentPart["content_type"]>([
  "text",
  "spoken",
  "audio_file_pointer",
]);

/**
 * The first text part of the written answer that ends the message, or -1 when
 * something else (a tool call, a card) comes after its last text.
 */
export const writtenAnswerStart = (content: ContentPart[]): number => {
  let start = -1;
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const type = content[index].content_type;
    if (!followsWrittenAnswer.has(type)) break;
    if (type === "text") start = index;
  }
  return start;
};

interface HastNode {
  type: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** Rehype plugin: marks the first block of a text part as the answer's start. */
export function rehypeWrittenStart() {
  return (tree: HastNode) => {
    const first = tree.children?.find((child) => child.type === "element");
    if (first) first.properties = { ...first.properties, dataWrittenStart: "" };
  };
}

/**
 * Where the view rests in audio mode, as a scrollTop, or null for the
 * bottom: a waiting card in view whole, or at least its decision at its end;
 * otherwise no further down than the start of the written answer, which the
 * person listens to and reads from its start.
 */
export const restingTop = ({
  clientHeight,
  waitingCard,
  answerStart,
}: {
  clientHeight: number;
  waitingCard: { top: number; height: number } | null;
  answerStart: number | null;
}): number | null => {
  if (waitingCard) {
    const decisionInView =
      waitingCard.top +
      waitingCard.height +
      CONVERSATION_MARGIN_PX -
      clientHeight;
    return Math.max(decisionInView, waitingCard.top - CONVERSATION_MARGIN_PX);
  }
  return answerStart === null ? null : answerStart - CONVERSATION_MARGIN_PX;
};

const topInList = (element: Element, container: HTMLElement) =>
  element.getBoundingClientRect().top -
  container.getBoundingClientRect().top +
  container.scrollTop;

/**
 * The list's height a person sees: a composer floating over its end
 * (globals.css, the app's glass) declares what it covers as the list's
 * scroll padding.
 */
export const visibleListHeight = (container: HTMLElement): number =>
  container.clientHeight -
  (parseFloat(window.getComputedStyle(container).scrollPaddingBottom) || 0);

/** `restingTop`, measured in the list for its last message. */
export const conversationRestingTop = (
  container: HTMLElement,
  lastMessageId: string | undefined,
): number | null => {
  if (lastMessageId === undefined) return null;
  const row = container.querySelector(
    `[data-message-id="${CSS.escape(lastMessageId)}"]`,
  );
  if (!row) return null;
  const card = Array.from(
    row.querySelectorAll(`[${WAITING_CARD_ATTRIBUTE}]`),
  ).at(-1);
  const start = row.querySelector(`[${WRITTEN_START_ATTRIBUTE}]`);
  return restingTop({
    clientHeight: visibleListHeight(container),
    waitingCard: card
      ? {
          top: topInList(card, container),
          height: card.getBoundingClientRect().height,
        }
      : null,
    answerStart: start ? topInList(start, container) : null,
  });
};

/**
 * Counts the person's turns: one more when they send or edit (both add a
 * message still being sent) or one of theirs goes; none when the saved
 * message replaces the optimistic one with the server's id and time. Also
 * whether a reply is coming now.
 */
export const usePersonTurn = (
  messageOrder: string[],
  messages: Record<string, ChatMessage>,
): { turn: number; replying: boolean } => {
  const { count, sendingId, replying } = useMemo(() => {
    let turns = 0;
    let sending: string | null = null;
    for (const id of messageOrder) {
      const message = messages[id];
      if (message.role !== "user" || taskResultOf(message)) continue;
      turns += 1;
      if (message.status === "sending") sending = id;
    }
    const last = messageOrder.at(-1);
    const streaming =
      last !== undefined &&
      messages[last].role === "assistant" &&
      messages[last].loading !== undefined;
    return {
      count: turns,
      sendingId: sending,
      replying: sending !== null || streaming,
    };
  }, [messageOrder, messages]);
  const seen = useRef({ count, sendingId, turn: 0 });
  if (
    seen.current.count !== count ||
    (sendingId !== null && sendingId !== seen.current.sendingId)
  ) {
    seen.current = { count, sendingId, turn: seen.current.turn + 1 };
  } else {
    seen.current.sendingId = sendingId;
  }
  return { turn: seen.current.turn, replying };
};
