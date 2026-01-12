import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useState, useCallback } from "react";

import { useSubmitMessageFeedback } from "@/lib/generated/v1betaApi/v1betaApiComponents";
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
  const { _ } = useLingui();

  // Get feature configuration
  const feedbackConfig = useMessageFeedbackFeature();

  // API mutation for submitting feedback
  const submitFeedbackMutation = useSubmitMessageFeedback();

  // State for feedback comment dialog (create or edit)
  const [feedbackDialogState, setFeedbackDialogState] =
    useState<FeedbackDialogState>({
      isOpen: false,
      messageId: null,
      sentiment: null,
      mode: "create",
      initialComment: "",
      error: null,
    });

  // State for feedback view dialog (read-only)
  const [feedbackViewDialogState, setFeedbackViewDialogState] =
    useState<FeedbackViewDialogState>({
      isOpen: false,
      messageId: null,
      feedback: null,
    });

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
      mode: "create",
      initialComment: "",
      error: null,
    });
  }, []);

  /**
   * Closes the feedback view dialog and resets state.
   */
  const closeFeedbackViewDialog = useCallback(() => {
    setFeedbackViewDialogState({
      isOpen: false,
      messageId: null,
      feedback: null,
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
        const result = await handleFeedbackSubmit(
          feedbackDialogState.messageId,
          feedbackDialogState.sentiment,
          comment,
        );

        if (!result.success && result.errorType === "time_limit_exceeded") {
          // Show error in dialog instead of closing
          setFeedbackDialogState((prev) => ({
            ...prev,
            error: _(
              msg({
                id: "feedback.error.time_limit_exceeded",
                message:
                  "The editing window has expired. Feedback can no longer be modified.",
              }),
            ),
          }));
          return;
        }

        if (result.success) {
          closeFeedbackDialog();
        }
      }
    },
    [feedbackDialogState, handleFeedbackSubmit, closeFeedbackDialog, _],
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
      });
    },
    [],
  );

  /**
   * Switches from view mode to edit mode for feedback.
   */
  const switchToEditMode = useCallback(() => {
    if (feedbackViewDialogState.feedback) {
      const feedback = feedbackViewDialogState.feedback;
      setFeedbackDialogState({
        isOpen: true,
        messageId: feedbackViewDialogState.messageId,
        sentiment: feedback.sentiment === "positive" ? "positive" : "negative",
        mode: "edit",
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- comment type is incorrectly generated as null|undefined
        initialComment: feedback.comment ?? "",
        error: null,
      });
      closeFeedbackViewDialog();
    }
  }, [feedbackViewDialogState, closeFeedbackViewDialog]);

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
    closeFeedbackDialog,
    closeFeedbackViewDialog,
    handleFeedbackDialogSubmit,
    openFeedbackDialog,
    openFeedbackViewDialog,
    switchToEditMode,
    canEditFeedback,
  };
}
