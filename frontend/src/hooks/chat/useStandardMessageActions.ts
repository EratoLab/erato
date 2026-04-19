import { useCallback } from "react";

import type { ChatMessage } from "@/components/ui/MessageList/MessageList";
import type {
  ContentPart,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { MessageAction } from "@/types/message-controls";

export type EditMessageState =
  | { mode: "compose" }
  | {
      mode: "edit";
      messageId: string;
      initialContent: ContentPart[];
      initialFiles: FileUploadItem[];
    };

interface UseStandardMessageActionsOptions {
  messages: Record<string, ChatMessage>;
  setEditState: (state: EditMessageState) => void;
  handleRegenerate: (messageId: string) => void;
  handleFeedbackSubmit: (
    messageId: string,
    sentiment: "positive" | "negative",
  ) => Promise<{ success: boolean; errorType?: string }>;
  feedbackConfig: { commentsEnabled: boolean };
  openFeedbackDialog: (
    messageId: string,
    sentiment: "positive" | "negative",
  ) => void;
  /**
   * Called for actions the hook does not handle (e.g. "copy"). Return value is
   * propagated to the MessageList caller.
   */
  onUnhandledAction?: (action: MessageAction) => Promise<boolean>;
}

/**
 * Returns an onMessageAction handler that covers the intrinsic chat actions
 * (edit, regenerate, like, dislike) shared by the main Chat and AddinChat
 * components. Caller-specific actions (copy policy, etc.) are delegated via
 * onUnhandledAction.
 */
export function useStandardMessageActions({
  messages,
  setEditState,
  handleRegenerate,
  handleFeedbackSubmit,
  feedbackConfig,
  openFeedbackDialog,
  onUnhandledAction,
}: UseStandardMessageActionsOptions) {
  return useCallback(
    async (action: MessageAction): Promise<boolean> => {
      if (action.type === "edit") {
        const messageToEdit = messages[action.messageId];
        if (messageToEdit.role === "user") {
          const messageFiles = (
            messageToEdit as ChatMessage & { files?: FileUploadItem[] }
          ).files;
          setEditState({
            mode: "edit",
            messageId: action.messageId,
            initialContent: messageToEdit.content,
            initialFiles: Array.isArray(messageFiles) ? messageFiles : [],
          });
        }
        return true;
      }

      if (action.type === "regenerate") {
        handleRegenerate(action.messageId);
        return true;
      }

      if (action.type === "like" || action.type === "dislike") {
        const sentiment =
          action.type === "like" ? "positive" : "negative";
        const result = await handleFeedbackSubmit(action.messageId, sentiment);
        if (result.success && feedbackConfig.commentsEnabled) {
          openFeedbackDialog(action.messageId, sentiment);
        }
        return result.success;
      }

      if (onUnhandledAction) {
        return onUnhandledAction(action);
      }
      return false;
    },
    [
      messages,
      setEditState,
      handleRegenerate,
      handleFeedbackSubmit,
      feedbackConfig,
      openFeedbackDialog,
      onUnhandledAction,
    ],
  );
}
