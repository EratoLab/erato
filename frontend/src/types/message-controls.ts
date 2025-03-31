import type { ReactNode } from "react";

/**
 * Possible message actions a user can take
 */
export type MessageAction =
  | "copy"
  | "delete"
  | "edit"
  | "regenerate"
  | "share"
  | "flag";

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
  onAction: (action: MessageAction) => void | Promise<void>;
  context: MessageControlsContext;
}

/**
 * Type for a component that displays message controls
 */
export type MessageControlsComponent = (
  props: MessageControlsProps,
) => ReactNode;
