import { useState, useCallback } from "react";

import { useSubmitMessageFeedback } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useMessageFeedbackFeature } from "@/providers/FeatureConfigProvider";
import { createLogger } from "@/utils/debugLogger";

const logger = createLogger("HOOK", "useMessageFeedback");

/**
 * State for the feedback comment dialog
 */
interface FeedbackDialogState {
  isOpen: boolean;
  messageId: string | null;
  sentiment: "positive" | "negative" | null;
}

/**
 * Custom hook to manage message feedback functionality.
 *
 * This hook encapsulates all feedback-related logic including:
 * - Feature configuration
 * - API mutations for submitting feedback
 * - Dialog state management
 * - Feedback submission handlers
 *
 * @returns Object containing feedback state and handlers
 *
 * @example
 * ```tsx
 * const {
 *   feedbackDialogState,
 *   feedbackConfig,
 *   handleFeedbackSubmit,
 *   closeFeedbackDialog,
 *   handleFeedbackDialogSubmit
 * } = useMessageFeedback();
 * ```
 */
export function useMessageFeedback() {
  // Get feature configuration
  const feedbackConfig = useMessageFeedbackFeature();

  // API mutation for submitting feedback
  const submitFeedbackMutation = useSubmitMessageFeedback();

  // State for feedback dialog
  const [feedbackDialogState, setFeedbackDialogState] =
    useState<FeedbackDialogState>({
      isOpen: false,
      messageId: null,
      sentiment: null,
    });

  /**
   * Submits feedback for a message.
   *
   * @param messageId - The ID of the message to submit feedback for
   * @param sentiment - Whether the feedback is positive or negative
   * @param comment - Optional comment text to include with the feedback
   * @returns Promise<boolean> - True if submission was successful, false otherwise
   */
  const handleFeedbackSubmit = useCallback(
    async (
      messageId: string,
      sentiment: "positive" | "negative",
      comment?: string,
    ): Promise<boolean> => {
      try {
        // Note: OpenAPI spec has comment as string|null but codegen quirk creates null|undefined
        // We use type assertion since the backend correctly accepts string|null
        // TODO: Fix OpenAPI spec or codegen to properly handle string|null
        const trimmedComment = comment?.trim();
        await submitFeedbackMutation.mutateAsync({
          pathParams: { messageId },
          body: {
            sentiment,
            comment: (trimmedComment ?? undefined) as null | undefined,
          },
        });
        logger.log(
          `Feedback submitted successfully for message ${messageId}: ${sentiment}`,
        );
        return true;
      } catch (error) {
        logger.log(
          `Failed to submit feedback for message ${messageId}:`,
          error,
        );
        return false;
      }
    },
    [submitFeedbackMutation],
  );

  /**
   * Closes the feedback comment dialog and resets state.
   */
  const closeFeedbackDialog = useCallback(() => {
    setFeedbackDialogState({
      isOpen: false,
      messageId: null,
      sentiment: null,
    });
  }, []);

  /**
   * Handles feedback dialog submission with an optional comment.
   *
   * @param comment - The comment text to submit
   */
  const handleFeedbackDialogSubmit = useCallback(
    async (comment: string) => {
      if (feedbackDialogState.messageId && feedbackDialogState.sentiment) {
        await handleFeedbackSubmit(
          feedbackDialogState.messageId,
          feedbackDialogState.sentiment,
          comment,
        );
      }
      closeFeedbackDialog();
    },
    [feedbackDialogState, handleFeedbackSubmit, closeFeedbackDialog],
  );

  /**
   * Opens the feedback dialog with the specified message and sentiment.
   *
   * @param messageId - The ID of the message
   * @param sentiment - The sentiment of the feedback
   */
  const openFeedbackDialog = useCallback(
    (messageId: string, sentiment: "positive" | "negative") => {
      setFeedbackDialogState({
        isOpen: true,
        messageId,
        sentiment,
      });
    },
    [],
  );

  return {
    feedbackDialogState,
    feedbackConfig,
    handleFeedbackSubmit,
    closeFeedbackDialog,
    handleFeedbackDialogSubmit,
    openFeedbackDialog,
  };
}
