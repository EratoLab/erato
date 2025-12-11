"use client";

import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState, useCallback } from "react";

import { Button } from "../Controls/Button";
import { ModalBase } from "../Modal/ModalBase";
import { ThumbUpIcon, ThumbDownIcon } from "../icons";

import type React from "react";

interface FeedbackCommentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (comment: string) => void | Promise<void>;
  sentiment: "positive" | "negative" | null;
}

export const FeedbackCommentDialog: React.FC<FeedbackCommentDialogProps> = ({
  isOpen,
  onClose,
  onSubmit,
  sentiment,
}) => {
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await onSubmit(comment);
      setComment(""); // Clear comment after successful submission
    } finally {
      setIsSubmitting(false);
    }
  }, [comment, onSubmit]);

  const handleSkip = useCallback(() => {
    setComment(""); // Clear any entered comment
    onClose();
  }, [onClose]);

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
      title={t`Add a comment`}
      contentClassName="max-w-lg"
    >
      <div className="space-y-4">
        {/* Sentiment indicator */}
        <div className="flex items-center gap-2 text-sm text-theme-fg-secondary">
          {sentiment === "positive" ? (
            <>
              <ThumbUpIcon className="size-4 text-green-500" />
              <Trans>You found this response helpful</Trans>
            </>
          ) : (
            <>
              <ThumbDownIcon className="size-4 text-red-500" />
              <Trans>You found this response unhelpful</Trans>
            </>
          )}
        </div>

        {/* Comment textarea */}
        <div>
          <label
            htmlFor="feedback-comment"
            className="mb-1 block text-sm font-medium text-theme-fg-primary"
          >
            <Trans>Would you like to add more details? (optional)</Trans>
          </label>
          <textarea
            id="feedback-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t`What could have been better?`}
            className="h-24 w-full resize-none rounded-lg border border-theme-border-primary bg-theme-bg-primary p-3 text-sm text-theme-fg-primary placeholder:text-theme-fg-muted focus:border-theme-border-focus focus:outline-none focus:ring-1 focus:ring-theme-border-focus"
            disabled={isSubmitting}
          />
          <p className="mt-1 text-xs text-theme-fg-muted">
            <Trans>Press Ctrl+Enter to submit</Trans>
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={handleSkip}
            disabled={isSubmitting}
            aria-label={t`Skip adding comment`}
          >
            <Trans>Skip</Trans>
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
            aria-label={t`Submit feedback with comment`}
          >
            {isSubmitting ? (
              <Trans>Submitting...</Trans>
            ) : (
              <Trans>Submit</Trans>
            )}
          </Button>
        </div>
      </div>
    </ModalBase>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
FeedbackCommentDialog.displayName = "FeedbackCommentDialog";
