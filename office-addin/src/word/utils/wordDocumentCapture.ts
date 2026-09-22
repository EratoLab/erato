import type { WordAuthoringSnapshot } from "./wordDocumentPlan";
import type { Message } from "@erato/frontend/library";

/** One paragraph as it stood at send time. */
export interface WordCapturedParagraph {
  uniqueLocalId: string;
  text: string;
}

/**
 * Send-time document identity and ordinal-to-paragraph map, paired with the
 * assistant message. Editing or regenerating a message replays stored facet
 * arguments, so writes must compare this captured source with current text.
 */
export interface WordDocumentCapture {
  identity: string;
  authoring?: WordAuthoringSnapshot;
  ordinalMap: ReadonlyMap<number, WordCapturedParagraph>;
  /**
   * Last ordinal reached by the excerpt window. The full ordinal map also holds
   * paragraphs outside that window, so writes must check this bound separately.
   * renderedOrdinals identifies complete text inside it; blank or truncated
   * paragraphs are not writable endpoints merely because they fall in range.
   */
  paragraphsSent: number;
  /**
   * Ordinals rendered in full by the excerpt builder. Span endpoints must be
   * in this set. Interior blank paragraphs may be absent: replacing a passage
   * can still include the blank lines between its visible endpoints.
   */
  renderedOrdinals: ReadonlySet<number>;
  /**
   * The single ordinal the send cut mid-paragraph, or null. Never writable,
   * and reported with its own reason: the model read a prefix of it, so a
   * replacement would silently delete the tail nobody ever saw.
   */
  partialOrdinal: number | null;
}

/**
 * Reuse the original exchange capture when a user message is edited: replay
 * uses its stored document arguments, not the currently open document.
 * Return null if no reply exists or the session has lost that capture.
 */
export function resolveEditWordCapture(
  messages: Record<string, Message>,
  messageOrder: readonly string[],
  editedMessageId: string,
  capturesByAssistantId: ReadonlyMap<string, WordDocumentCapture>,
): WordDocumentCapture | null {
  const exchangeAssistantId = messageOrder.find(
    (id) =>
      messages[id]?.role === "assistant" &&
      messages[id]?.previous_message_id === editedMessageId,
  );

  return exchangeAssistantId
    ? (capturesByAssistantId.get(exchangeAssistantId) ?? null)
    : null;
}
