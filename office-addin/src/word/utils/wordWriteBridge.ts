import type { WordReviewState } from "./wordReviewState";
import type { WordRevertSlot } from "../providers/WordWriteProvider";
import type { ContentPart } from "@erato/frontend/library";
import type { WordDocumentCapture } from "@erato/frontend/word-review";

/** What the pane knows about an assistant message of the open chat, read from its stored turn. */
export interface WordMessageContext {
  /** The document the message was made for: the identity stamped on its artifact. */
  identity?: string;
  /** The user's request this message answers. */
  requestText?: string;
  /** The model the message was generated with. */
  modelId?: string;
  /** The files sent with the request. */
  fileIds?: string[];
  /** The message's parts as the pane has them now. */
  content?: readonly ContentPart[];
  /** The message is the chat's latest answer. */
  latest?: boolean;
}

/**
 * The open pane's write host for code that runs outside the card tree: the server-called apply
 * executors. Set by the provider while it is mounted.
 */
export interface WordWriteBridge {
  documentIdentity: () => string | null;
  updateReview: (key: string, patch: Partial<WordReviewState>) => void;
  beginOperation: () => boolean;
  endOperation: () => void;
  /** Keeps Word's operation until a write that outlived its timeout has ended. */
  holdOperationUntil: (settled: Promise<void>, owner: string) => void;
  setRevertSlot: (slot: WordRevertSlot | null) => void;
  invalidateLocations: () => void;
  messageContext: (messageId: string) => WordMessageContext;
  /** The copy of the document taken when the request of this answer was sent. */
  captureFor: (messageId: string) => WordDocumentCapture | undefined;
  /** Where a card's review stands. */
  reviewFor: (key: string) => WordReviewState | undefined;
  /** The generation a card's result anchors must carry to be shown in the document. */
  locationGeneration: () => number;
}

let current: WordWriteBridge | null = null;

export function setWordWriteBridge(bridge: WordWriteBridge | null): void {
  current = bridge;
}

export function wordWriteBridge(): WordWriteBridge | null {
  return current;
}

let principalName: string | undefined;

/** The signed-in user's name, which comment adds under the user's name carry. */
export function setWordPrincipalName(name: string | undefined): void {
  principalName = name;
}

export function wordPrincipalName(): string | undefined {
  return principalName;
}
