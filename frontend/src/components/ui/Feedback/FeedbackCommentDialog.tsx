"use client";

import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState, useCallback, useEffect } from "react";

import { Button } from "../Controls/Button";
import { Textarea } from "../Input/Textarea";
import { ModalBase } from "../Modal/ModalBase";
import { ThumbUpIcon, ThumbDownIcon } from "../icons";

import type React from "react";

interface FeedbackCommentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (comment: string) => void | Promise<void>;
  sentiment: "positive" | "negative" | null;
  mode?: "create" | "edit";
  initialComment?: string;
  error?: string | null;
}

export const FeedbackCommentDialog: React.FC<FeedbackCommentDialogProps> = ({
  isOpen,
  onClose,
  onSubmit,
  sentiment,
  mode = "create",
  initialComment = "",
  error = null,
}) => {
  const [comment, setComment] = useState(initialComment);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync comment state when dialog opens or initialComment changes (e.g., switching to edit mode)
  useEffect(() => {
    if (isOpen) {
      setComment(initialComment);
    }
  }, [isOpen, initialComment]);

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await onSubmit(comment);
      if (mode === "create") {
        setComment(""); // Clear comment after successful submission in create mode
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [comment, onSubmit, mode]);

  const handleSkip = useCallback(() => {
    if (mode === "create") {
      setComment(""); // Clear any entered comment in create mode
    }
    onClose();
  }, [onClose, mode]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Submit on Ctrl/Cmd + Enter
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit],
  );

  if (!isOpen) {
    return null;
  }

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={handleSkip}
      title={t({ id: "feedback.comment.title", message: "Add a comment" })}
      contentClassName="max-w-lg"
    >
      <div className="space-y-4">
        {/* Error message */}
        {error && (
          <div className="rounded-md bg-theme-error-bg p-3 text-sm text-theme-error-fg">
            {error}
          </div>
        )}

        {/* Sentiment indicator */}
        <div className="flex items-center gap-2 text-sm text-theme-fg-secondary">
          {sentiment === "positive" ? (
            <>
              <ThumbUpIcon className="size-4 text-theme-success-fg" />
              <Trans id="feedback.comment.positive">
                You found this response helpful
              </Trans>
            </>
          ) : (
            <>
              <ThumbDownIcon className="size-4 text-theme-error-fg" />
              <Trans id="feedback.comment.negative">
                You found this response unhelpful
              </Trans>
            </>
          )}
        </div>

        {/* Comment textarea */}
        <div>
          <label
            htmlFor="feedback-comment"
            className="mb-1 block text-sm font-medium text-theme-fg-primary"
          >
            <Trans id="feedback.comment.label">
              Would you like to add more details? (optional)
            </Trans>
          </label>
          <Textarea
            id="feedback-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={(() => {
              // Try to get sentiment-specific placeholder first
              let sentimentPlaceholder =
                sentiment === "positive"
                  ? t({
                      id: "feedback.comment.placeholder.positive",
                      message: "", // eslint-disable-line lingui/no-single-variables-to-translate
                    })
                  : t({
                      id: "feedback.comment.placeholder.negative",
                      message: "", // eslint-disable-line lingui/no-single-variables-to-translate
                    });

              // In case no override is provided, lingui falls back to fill in the msgId.
              // In this case we clear the string.
              if (
                sentimentPlaceholder ===
                  "feedback.comment.placeholder.positive" ||
                sentimentPlaceholder === "feedback.comment.placeholder.negative"
              ) {
                sentimentPlaceholder = "";
              }

              // If sentiment-specific placeholder is provided (not empty), use it
              // Otherwise fall back to the default placeholder
              return (
                sentimentPlaceholder ||
                t({
                  id: "feedback.comment.placeholder",
                  message: "What could have been better?",
                })
              );
            })()}
            rows={4}
            disabled={isSubmitting}
            aria-label={t({
              id: "feedback.comment.aria",
              message: "Feedback comment",
            })}
          />
          <p className="mt-1 text-xs text-theme-fg-muted">
            <Trans id="feedback.comment.hint">Press Ctrl+Enter to submit</Trans>
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={handleSkip}
            disabled={isSubmitting}
            aria-label={
              mode === "create"
                ? t({
                    id: "feedback.comment.skip.aria",
                    message: "Skip adding comment",
                  })
                : t({ id: "Cancel", message: "Cancel" })
            }
          >
            {mode === "create" ? (
              <Trans id="feedback.comment.skip">Skip</Trans>
            ) : (
              <Trans id="Cancel">Cancel</Trans>
            )}
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
            aria-label={t({
              id: "feedback.comment.submit.aria",
              message: "Submit feedback with comment",
            })}
          >
            {isSubmitting ? (
              <Trans id="feedback.comment.submitting">Submitting...</Trans>
            ) : mode === "edit" ? (
              <Trans id="feedback.edit.update">Update</Trans>
            ) : (
              <Trans id="feedback.comment.submit">Submit</Trans>
            )}
          </Button>
        </div>
      </div>
    </ModalBase>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
FeedbackCommentDialog.displayName = "FeedbackCommentDialog";
