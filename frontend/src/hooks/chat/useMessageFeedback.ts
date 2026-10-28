import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useState, useCallback, useRef } from "react";

import {
  useDeleteMessageFeedback,
  useSubmitMessageFeedback,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useMessageFeedbackFeature } from "@/providers/FeatureConfigProvider";
import { createLogger } from "@/utils/debugLogger";

import type { MessageFeedback } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const logger = createLogger("HOOK", "useMessageFeedback");

/**
 * State for the feedback comment dialog
 */
interface FeedbackDialogState {
  isOpen: boolean;
  messageId: string | null;
  sentiment: "positive" | "negative" | null;
  mode: "create" | "edit";
  initialComment: string;
  error: string | null;
}

/**
 * State for the feedback view dialog
 */
interface FeedbackViewDialogState {
  isOpen: boolean;
  messageId: string | null;
  feedback: MessageFeedback | null;
  error: string | null;
  isRemoving: boolean;
}

const CLOSED_FEEDBACK_DIALOG: FeedbackDialogState = {
  isOpen: false,
  messageId: null,
  sentiment: null,
  mode: "create",
  initialComment: "",
  error: null,
};

const CLOSED_FEEDBACK_VIEW_DIALOG: FeedbackViewDialogState = {
  isOpen: false,
  messageId: null,
  feedback: null,
  error: null,
  isRemoving: false,
};

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
 * } = useMessageFeedback({
 *   onFeedbackSuccess: (messageId) => {
 *     // Invalidate cache, refresh data, etc.
 *   }
 * });
 * ```
 */

interface UseMessageFeedbackOptions {
  /**
   * Callback invoked after any successful feedback submission (initial or dialog).
   * Useful for cache invalidation or other side effects.
   */
  onFeedbackSuccess?: (messageId: string) => void;
}

export function useMessageFeedback(options: UseMessageFeedbackOptions = {}) {
  const { onFeedbackSuccess } = options;
  const { _ } = useLingui();

  // Get feature configuration
  const feedbackConfig = useMessageFeedbackFeature();

  // API mutation for submitting feedback
  const submitFeedbackMutation = useSubmitMessageFeedback();

  // API mutation for removing feedback
  const deleteFeedbackMutation = useDeleteMessageFeedback();

  // State for feedback comment dialog (create or edit)
  const [feedbackDialogState, setFeedbackDialogState] =
    useState<FeedbackDialogState>(CLOSED_FEEDBACK_DIALOG);

  // State for feedback view dialog (read-only)
  const [feedbackViewDialogState, setFeedbackViewDialogState] =
    useState<FeedbackViewDialogState>(CLOSED_FEEDBACK_VIEW_DIALOG);

  const removingMessageIdRef = useRef<string | null>(null);

  /**
   * Submits feedback for a message.
   *
   * @param messageId - The ID of the message to submit feedback for
   * @param sentiment - Whether the feedback is positive or negative
   * @param comment - Optional comment text to include with the feedback
   * @returns Promise<{success: boolean, errorType?: string}> - Success status and optional error type
   */
  const handleFeedbackSubmit = useCallback(
    async (
      messageId: string,
      sentiment: "positive" | "negative",
      comment?: string,
    ): Promise<{ success: boolean; errorType?: string }> => {
      try {
        const trimmedComment = comment?.trim();
        await submitFeedbackMutation.mutateAsync({
          pathParams: { messageId },
          body: {
            sentiment,
            comment: trimmedComment ?? undefined,
          },
        });
        logger.log(
          `Feedback submitted successfully for message ${messageId}: ${sentiment}`,
        );
        // Notify caller of successful submission for cache invalidation
        onFeedbackSuccess?.(messageId);
        return { success: true };
      } catch (error) {
        logger.log(
          `Failed to submit feedback for message ${messageId}:`,
          error,
        );
        // Check if it's a 403 Forbidden error (time limit exceeded)
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          error.status === 403
        ) {
          // eslint-disable-next-line lingui/no-unlocalized-strings -- error type identifier, not user-facing
          return { success: false, errorType: "time_limit_exceeded" };
        }

        return { success: false, errorType: "unknown" };
      }
    },
    [submitFeedbackMutation, onFeedbackSuccess],
  );

  /**
   * Removes previously submitted feedback for a message.
   *
   * @param messageId - The ID of the message whose feedback should be removed
   * @returns Promise<{success: boolean, errorType?: string}> - Success status and optional error type
   */
  const handleFeedbackRemove = useCallback(
    async (
      messageId: string,
    ): Promise<{ success: boolean; errorType?: string }> => {
      try {
        await deleteFeedbackMutation.mutateAsync({
          pathParams: { messageId },
        });
        logger.log(`Feedback removed successfully for message ${messageId}`);
        onFeedbackSuccess?.(messageId);
        return { success: true };
      } catch (error) {
        logger.log(
          `Failed to remove feedback for message ${messageId}:`,
          error,
        );
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          error.status === 403
        ) {
          // eslint-disable-next-line lingui/no-unlocalized-strings -- error type identifier, not user-facing
          return { success: false, errorType: "time_limit_exceeded" };
        }

        return { success: false, errorType: "unknown" };
      }
    },
    [deleteFeedbackMutation, onFeedbackSuccess],
  );

  /**
   * Closes the feedback comment dialog and resets state.
   */
  const closeFeedbackDialog = useCallback(() => {
    setFeedbackDialogState(CLOSED_FEEDBACK_DIALOG);
  }, []);

  /**
   * Closes the feedback view dialog and resets state.
   */
  const closeFeedbackViewDialog = useCallback(() => {
    setFeedbackViewDialogState(CLOSED_FEEDBACK_VIEW_DIALOG);
  }, []);

  /**
   * Removes the feedback currently shown in the view dialog.
   * Closes the dialog on success, shows an error inside it otherwise.
   */
  const handleFeedbackViewDialogRemove = useCallback(async () => {
    const messageId = feedbackViewDialogState.messageId;
    // A ref, so a second click is ignored even where isRemoving never
    // reaches the button.
    if (!messageId || removingMessageIdRef.current === messageId) {
      return;
    }

    removingMessageIdRef.current = messageId;
    setFeedbackViewDialogState((prev) => ({
      ...prev,
      error: null,
      isRemoving: true,
    }));
    const result = await handleFeedbackRemove(messageId);
    if (removingMessageIdRef.current === messageId) {
      removingMessageIdRef.current = null;
    }

    const error = result.success
      ? null
      : result.errorType === "time_limit_exceeded"
        ? _(
            msg({
              id: "feedback.error.time_limit_exceeded",
              message:
                "The editing window has expired. Feedback can no longer be modified.",
            }),
          )
        : _(
            msg({
              id: "feedback.error.remove_failed",
              message: "Failed to remove feedback. Please try again.",
            }),
          );
    // The dialog may have been closed, or reopened for another message, meanwhile.
    setFeedbackViewDialogState((prev) => {
      if (prev.messageId !== messageId) return prev;
      return result.success
        ? CLOSED_FEEDBACK_VIEW_DIALOG
        : { ...prev, isRemoving: false, error };
    });
  }, [feedbackViewDialogState.messageId, handleFeedbackRemove, _]);

  /**
   * Handles feedback dialog submission with an optional comment.
   *
   * @param comment - The comment text to submit
   */
  const handleFeedbackDialogSubmit = useCallback(
    async (comment: string) => {
      const { messageId, sentiment } = feedbackDialogState;
      if (!messageId || !sentiment) return;

      setFeedbackDialogState((prev) => ({ ...prev, error: null }));
      const result = await handleFeedbackSubmit(messageId, sentiment, comment);

      const error = result.success
        ? null
        : result.errorType === "time_limit_exceeded"
          ? _(
              msg({
                id: "feedback.error.time_limit_exceeded",
                message:
                  "The editing window has expired. Feedback can no longer be modified.",
              }),
            )
          : _(
              msg({
                id: "feedback.error.submit_failed",
                message: "Failed to submit feedback. Please try again.",
              }),
            );
      setFeedbackDialogState((prev) => {
        if (prev.messageId !== messageId) return prev;
        return result.success ? CLOSED_FEEDBACK_DIALOG : { ...prev, error };
      });
    },
    [feedbackDialogState, handleFeedbackSubmit, _],
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
        mode: "create",
        initialComment: "",
        error: null,
      });
    },
    [],
  );

  /**
   * Opens the feedback view dialog to display existing feedback.
   *
   * @param messageId - The ID of the message
   * @param feedback - The existing feedback to display
   */
  const openFeedbackViewDialog = useCallback(
    (messageId: string, feedback: MessageFeedback) => {
      setFeedbackViewDialogState({
        isOpen: true,
        messageId,
        feedback,
        error: null,
        isRemoving: false,
      });
    },
    [],
  );

  /**
   * Switches from view mode to edit mode for feedback.
   *
   * @param newSentiment - Optional new sentiment to use when editing (allows changing sentiment)
   */
  const switchToEditMode = useCallback(
    (newSentiment?: "positive" | "negative") => {
      if (feedbackViewDialogState.feedback) {
        const feedback = feedbackViewDialogState.feedback;
        const sentiment =
          newSentiment ??
          (feedback.sentiment === "positive" ? "positive" : "negative");
        setFeedbackDialogState({
          isOpen: true,
          messageId: feedbackViewDialogState.messageId,
          sentiment,
          mode: "edit",
          initialComment: feedback.comment ?? "",
          error: null,
        });
        closeFeedbackViewDialog();
      }
    },
    [feedbackViewDialogState, closeFeedbackViewDialog],
  );

  /**
   * Checks if editing is allowed based on time limit configuration.
   */
  const canEditFeedback = useCallback(
    (feedback: MessageFeedback): boolean => {
      // If no time limit is set, editing is always allowed
      if (feedbackConfig.editTimeLimitSeconds === null) {
        return true;
      }

      // Calculate time elapsed since creation
      const createdAt = new Date(feedback.created_at);
      const now = new Date();
      const elapsedSeconds = (now.getTime() - createdAt.getTime()) / 1000;

      return elapsedSeconds <= feedbackConfig.editTimeLimitSeconds;
    },
    [feedbackConfig.editTimeLimitSeconds],
  );

  return {
    feedbackDialogState,
    feedbackViewDialogState,
    feedbackConfig,
    handleFeedbackSubmit,
    handleFeedbackRemove,
    handleFeedbackViewDialogRemove,
    closeFeedbackDialog,
    closeFeedbackViewDialog,
    handleFeedbackDialogSubmit,
    openFeedbackDialog,
    openFeedbackViewDialog,
    switchToEditMode,
    canEditFeedback,
  };
}
