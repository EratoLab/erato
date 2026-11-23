import { extractTextFromContent } from "@erato/frontend/library";

import type { WordMessageContext } from "./wordWriteBridge";
import type { Message } from "@erato/frontend/library";

/**
 * The request and document an assistant message of the open chat answers, from its stored turn.
 * While the message streams, the pane holds a copy without its link to the user's message, so the
 * user's message is then the nearest one before it.
 */
export function wordMessageContext(
  messages: Readonly<Record<string, Message | undefined>>,
  order: readonly string[],
  messageId: string,
): WordMessageContext {
  const message = messages[messageId];
  let request = message?.previous_message_id
    ? messages[message.previous_message_id]
    : undefined;
  if (!request) {
    for (let at = order.indexOf(messageId) - 1; at >= 0; at -= 1) {
      const earlier = messages[order[at]];
      if (earlier?.role === "user") {
        request = earlier;
        break;
      }
    }
  }
  const requestText = request
    ? extractTextFromContent(request.content)
    : undefined;
  const identity =
    message?.hostArtifact?.itemIdentity ??
    request?.action_facet_args?.document_identity;
  return {
    ...(identity ? { identity } : {}),
    ...(requestText ? { requestText } : {}),
    ...(message ? { content: message.content } : {}),
  };
}
