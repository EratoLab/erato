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
}

/**
 * Props for message controls component
 */
export interface MessageControlsProps {
  messageId: string;
  isUserMessage: boolean;
  onAction: (action: MessageAction) => Promise<boolean>;
  context: MessageControlsContext;
  // Additional properties used in DefaultMessageControls
  messageType?: string;
  authorId?: string;
  createdAt?: string | Date;
  showOnHover?: boolean;
  className?: string;
}

/**
 * Type for a component that displays message controls
 */
export type MessageControlsComponent = (
  props: MessageControlsProps,
) => ReactNode;
