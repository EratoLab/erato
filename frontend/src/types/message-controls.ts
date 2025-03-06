import type { ReactNode } from "react";

export type MessageActionType = "copy" | "edit" | "like" | "dislike" | "rerun";

export interface MessageAction {
  type: MessageActionType;
  messageId: string;
  metadata?: Record<string, unknown>;
}

export interface MessageControlsContext {
  isSharedDialog?: boolean;
  currentUserId: string;
  dialogOwnerId: string;
}

export interface MessageControlsProps {
  messageId: string;
  messageType: "user" | "assistant";
  authorId: string;
  createdAt: Date;

  context: MessageControlsContext;
  showOnHover?: boolean;
  className?: string;

  onAction: (action: MessageAction) => void | Promise<void>;
  renderIcon?: (type: MessageActionType) => ReactNode;
}

// Helper type for the controls component injection
export type MessageControlsComponent =
  React.ComponentType<MessageControlsProps>;
