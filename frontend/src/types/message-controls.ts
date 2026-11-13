import type { MessageFeedback } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

/**
 * Possible message actions a user can take
 */
export type MessageActionType =
  | "copy"
  | "delete"
  | "edit"
  | "regenerate"
  | "share"
  | "flag"
  | "like"
  | "dislike";

export interface MessageAction {
  type: MessageActionType;
  messageId: string;
}

/**
 * Context provided to message controls
 */
export interface MessageControlsContext {
  currentUserId?: string;
  dialogOwnerId?: string;
  isSharedDialog?: boolean;
  /** Whether the current user can edit messages in this chat (coarse chat-level permission) */
  canEdit?: boolean;
}

/**
 * What the host knows about reading one message aloud. Built by
 * `useChatMessageRenderer`; message controls pass it to `ReadAloudButton`
 * unchanged.
 */
export interface MessageReadAloudFacts {
  /** The message is no longer being generated. */
  isFinished: boolean;
  /** The message has text that can be spoken. */
  hasText: boolean;
  /** Conversational mode already stored a spoken reply on the message. */
  hasSpokenAudio: boolean;
}

/**
 * Props for message controls component.
 *
 * All feature props are optional - custom implementations use what they need.
 */
export interface MessageControlsProps {
  // Core
  messageId: string;
  isUserMessage: boolean;
  onAction: (action: MessageAction) => Promise<boolean>;
  context: MessageControlsContext;

  // Identity
  messageType?: string;
  authorId?: string;
  createdAt?: string | Date;

  // UI behavior
  showOnHover?: boolean;
  className?: string;

  // Raw markdown toggle
  showRawMarkdown?: boolean;
  onToggleRawMarkdown?: () => void;

  // Feedback
  showFeedbackButtons?: boolean;
  showFeedbackComments?: boolean;
  initialFeedback?: MessageFeedback;
  onViewFeedback?: (messageId: string, feedback: MessageFeedback) => void;

  // Message metadata
  hasToolCalls?: boolean;

  /**
   * Set on assistant messages the user may have read aloud. Missing on user
   * messages, in the read-only view of a shared chat, and from a renderer
   * that does not build these props with `useChatMessageRenderer`; the read
   * aloud button then stays hidden.
   */
  readAloud?: MessageReadAloudFacts;
}

/**
 * Type for a component that displays message controls
 */
export type MessageControlsComponent = (
  props: MessageControlsProps,
) => ReactNode;
