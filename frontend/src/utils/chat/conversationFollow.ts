import { createContext, useContext } from "react";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Whether the message list follows a conversation spoken hands-free (audio
 * mode). Messages then mark where their written answer starts, which the list
 * keeps in view instead of chasing the stream to its end.
 */
export const ConversationFollowContext = createContext(false);

export const useFollowsConversation = () =>
  useContext(ConversationFollowContext);

export const WRITTEN_START_ATTRIBUTE = "data-written-start";

/** On an approval card while it waits for the person's decision. */
export const WAITING_CARD_ATTRIBUTE = "data-waiting-card";

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

/** Room left around what the view keeps in view. */
export const CONVERSATION_MARGIN_PX = 16;

/** Where things sit in the list, measured from the top of its content. */
export interface ConversationLayout {
  /** The scrollTop that shows the end of the list. */
  bottom: number;
  clientHeight: number;
  /** A card in the last message waiting for the person's decision. */
  waitingCard: { top: number; height: number } | null;
  /** The start of the written answer to a turn taken live. */
  answerStart: number | null;
}

/**
 * Where the view rests while it follows the conversation, as a scrollTop: the
 * bottom, except that a waiting card is in view whole, or at least its
 * decision at its end, and that the view stops at the start of the written
 * answer, which the person listens to and reads from its start.
 */
export const restingTop = ({
  bottom,
  clientHeight,
  waitingCard,
  answerStart,
}: ConversationLayout): number => {
  if (waitingCard) {
    const decisionInView =
      waitingCard.top +
      waitingCard.height +
      CONVERSATION_MARGIN_PX -
      clientHeight;
    const cardInView = waitingCard.top - CONVERSATION_MARGIN_PX;
    return Math.max(decisionInView, Math.min(bottom, cardInView));
  }
  if (answerStart !== null) {
    return Math.min(bottom, answerStart - CONVERSATION_MARGIN_PX);
  }
  return bottom;
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
