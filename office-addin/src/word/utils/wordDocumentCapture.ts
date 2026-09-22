import type { WordAuthoringSnapshot } from "./wordDocumentPlan";
import type { Message } from "@erato/frontend/library";

export interface WordCapturedParagraph {
  uniqueLocalId: string;
  text: string;
}

export interface WordDocumentCapture {
  identity: string;
  authoring?: WordAuthoringSnapshot;
  ordinalMap: ReadonlyMap<number, WordCapturedParagraph>;
  /** The capture includes more paragraphs than the model read; bind writes to the rendered set. */
  paragraphsSent: number;
  /** Both span endpoints must be fully read; blank interior paragraphs still belong to the passage. */
  renderedOrdinals: ReadonlySet<number>;
  /** A prefix is readable but not writable: replacing it would remove the unseen tail. */
  partialOrdinal: number | null;
}

/** Edited-message replay uses the original assistant capture, never the document currently open. */
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
