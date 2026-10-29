import { taskResultOf } from "./taskResultFolds";

import type { Message } from "@/types/chat";

type TurnMessage = Pick<Message, "id" | "role" | "content">;

export interface AssistantTurns {
  /** Messages drawn as part of the assistant turn above them. */
  continuing: ReadonlySet<string>;
  /** Messages the next drawn message continues. */
  continued: ReadonlySet<string>;
}

export const NO_ASSISTANT_TURNS: AssistantTurns = {
  continuing: new Set(),
  continued: new Set(),
};

const isAssistantSide = (message: TurnMessage) =>
  message.role === "assistant" || taskResultOf(message) !== undefined;

const isMarker = (message: TurnMessage) =>
  message.content.some((part) => part.content_type === "compaction_marker");

/**
 * Without a user message in between, assistant messages are one turn: a
 * delegated task's result and the reply to it come back into the turn that
 * started the task. A message with a marker drawn above it (`markedIds`, a
 * model switch) starts a new one.
 */
export function getAssistantTurns(
  messages: Readonly<Record<string, TurnMessage | undefined>>,
  messageOrder: readonly string[],
  hiddenIds: ReadonlySet<string>,
  markedIds: ReadonlySet<string> = new Set(),
): AssistantTurns {
  const continuing = new Set<string>();
  const continued = new Set<string>();
  let previous: TurnMessage | undefined;

  for (const id of messageOrder) {
    const message = messages[id];
    if (!message || hiddenIds.has(id)) continue;
    if (
      previous &&
      isAssistantSide(previous) &&
      isAssistantSide(message) &&
      !isMarker(previous) &&
      !isMarker(message) &&
      !markedIds.has(id)
    ) {
      continuing.add(message.id);
      continued.add(previous.id);
    }
    previous = message;
  }

  return continuing.size === 0 ? NO_ASSISTANT_TURNS : { continuing, continued };
}
