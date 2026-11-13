import { i18n } from "@lingui/core";
import { create } from "zustand";

import { createSSEConnection } from "@/utils/sse/sseClient";

import type { MessageTextAnchor } from "@/components/ui/Message/messageTextBlocks";
import type {
  MessageExplainRequest,
  MessageExplainStreamingResponseMessage,
  MessageExplainTurn,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/** The server's limits; a longer passage or small chat is refused there. */
export const MESSAGE_EXPLAIN_MAX_SELECTED_TEXT_CHARS = 4000;
export const MESSAGE_EXPLAIN_MAX_FOLLOW_UPS = 10;

export type MessageExplainTurnStatus =
  | "loading"
  | "streaming"
  | "done"
  | "error";

export interface MessageExplainTurnState {
  id: number;
  /** Null for the explanation the card opens with. */
  question: string | null;
  answer: string;
  status: MessageExplainTurnStatus;
}

export interface MessageExplainCardState {
  messageId: string;
  passage: string;
  anchor: MessageTextAnchor;
  turns: MessageExplainTurnState[];
}

interface MessageExplainState {
  /**
   * The one open small chat. It lives here and nowhere else: not persisted,
   * so a reload discards it, and outside the message row, so the row may
   * unmount and remount while the list scrolls.
   */
  card: MessageExplainCardState | null;
  open: (passage: {
    messageId: string;
    passage: string;
    anchor: MessageTextAnchor;
  }) => void;
  ask: (question: string) => void;
  /** Runs the failed last turn again. */
  retry: () => void;
  close: () => void;
}

let nextTurnId = 1;
let closeConnection: (() => void) | null = null;
let focusRequested = false;

/** True once after `open`: the card that mounts next was just opened. */
export const takeMessageExplainFocusRequest = (): boolean => {
  const requested = focusRequested;
  focusRequested = false;
  return requested;
};

const newTurn = (question: string | null): MessageExplainTurnState => ({
  id: nextTurnId++,
  question,
  answer: "",
  status: "loading",
});

export const isMessageExplainBusy = (card: MessageExplainCardState) => {
  const status = card.turns.at(-1)?.status;
  return status === "loading" || status === "streaming";
};

export const messageExplainFollowUpCount = (card: MessageExplainCardState) =>
  card.turns.filter((turn) => turn.question !== null).length;

/** The small chat as the server reads it: everything but the pending answer. */
export function messageExplainRequest(
  card: MessageExplainCardState,
): MessageExplainRequest {
  const turns: MessageExplainTurn[] = [];
  card.turns.forEach((turn, index) => {
    if (turn.question !== null) {
      turns.push({ role: "user", text: turn.question });
    }
    if (index < card.turns.length - 1) {
      turns.push({ role: "assistant", text: turn.answer });
    }
  });
  return {
    selected_text: card.passage,
    turns,
    language: i18n.locale || undefined,
  };
}

export const useMessageExplainStore = create<MessageExplainState>(
  (set, get) => {
    const run = () => {
      closeConnection?.();
      closeConnection = null;
      const card = get().card;
      const turnId = card?.turns.at(-1)?.id;
      if (!card || turnId === undefined) {
        return;
      }

      // Keyed by turn id, so a late event of a replaced request changes nothing.
      const updateTurn = (
        patch: (turn: MessageExplainTurnState) => MessageExplainTurnState,
      ) =>
        set((state) =>
          state.card?.turns.at(-1)?.id === turnId
            ? {
                card: {
                  ...state.card,
                  turns: state.card.turns.map((turn) =>
                    turn.id === turnId ? patch(turn) : turn,
                  ),
                },
              }
            : state,
        );
      const settle = (status: "done" | "error") =>
        updateTurn((turn) =>
          turn.status === "done" || turn.status === "error"
            ? turn
            : {
                ...turn,
                status:
                  status === "done" && turn.answer.trim() === ""
                    ? "error"
                    : status,
              },
        );

      closeConnection = createSSEConnection(
        `/api/v1beta/me/messages/${encodeURIComponent(card.messageId)}/explain`,
        {
          method: "POST",
          body: JSON.stringify(messageExplainRequest(card)),
          onMessage: (event) => {
            let message: MessageExplainStreamingResponseMessage;
            try {
              message = JSON.parse(
                event.data,
              ) as MessageExplainStreamingResponseMessage;
            } catch {
              return;
            }
            if (message.message_type === "text_delta") {
              const text = (message as { text: string }).text;
              updateTurn((turn) => ({
                ...turn,
                answer: turn.answer + text,
                status: "streaming",
              }));
            } else if (message.message_type === "completed") {
              settle("done");
            } else {
              settle("error");
            }
          },
          onError: () => settle("error"),
          // A stream that ends without `completed` was cut off.
          onClose: () => settle("error"),
        },
      );
    };

    return {
      card: null,
      open: ({ messageId, passage, anchor }) => {
        focusRequested = true;
        set({ card: { messageId, passage, anchor, turns: [newTurn(null)] } });
        run();
      },
      ask: (question) => {
        const card = get().card;
        const text = question.trim();
        if (
          !card ||
          text === "" ||
          isMessageExplainBusy(card) ||
          card.turns.at(-1)?.status === "error" ||
          messageExplainFollowUpCount(card) >= MESSAGE_EXPLAIN_MAX_FOLLOW_UPS
        ) {
          return;
        }
        set({ card: { ...card, turns: [...card.turns, newTurn(text)] } });
        run();
      },
      retry: () => {
        const card = get().card;
        const failed = card?.turns.at(-1);
        if (!card || failed?.status !== "error") {
          return;
        }
        set({
          card: {
            ...card,
            turns: [...card.turns.slice(0, -1), newTurn(failed.question)],
          },
        });
        run();
      },
      close: () => {
        closeConnection?.();
        closeConnection = null;
        focusRequested = false;
        set({ card: null });
      },
    };
  },
);
