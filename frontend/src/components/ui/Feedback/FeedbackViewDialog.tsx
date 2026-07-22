"use client";

import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useCallback } from "react";

import { Button } from "../Controls/Button";
import { ModalBase } from "../Modal/ModalBase";
import { ThumbUpIcon, ThumbDownIcon } from "../icons";

import type { MessageFeedback } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

interface FeedbackViewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onEdit: () => void;
  onRemove?: () => void;
  feedback: MessageFeedback | null;
  canEdit: boolean;
  error?: string | null;
}

export const FeedbackViewDialog: React.FC<FeedbackViewDialogProps> = ({
  isOpen,
  onClose,
  onEdit,
  onRemove,
  feedback,
  canEdit,
  error,
}) => {
  const handleEdit = useCallback(() => {
    onEdit();
  }, [onEdit]);

  if (!isOpen || !feedback) {
    return null;
  }

  const sentiment = feedback.sentiment === "positive" ? "positive" : "negative";

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title={t({ id: "feedback.view.title", message: "Your Feedback" })}
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
              <Trans id="feedback.like.active">You found this helpful</Trans>
            </>
          ) : (
            <>
              <ThumbDownIcon className="size-4 text-theme-error-fg" />
              <Trans id="feedback.dislike.active">
                You found this unhelpful
              </Trans>
            </>
          )}
        </div>

        {/* Comment display (if present) */}
        {feedback.comment && (
          <div>
            <p className="mb-1 block text-sm font-medium text-theme-fg-primary">
              <Trans id="feedback.comment.label">
                Would you like to add more details? (optional)
              </Trans>
            </p>
            <div className="rounded-md border border-theme-border-primary bg-theme-bg-tertiary p-3 text-sm text-theme-fg-primary">
              {feedback.comment}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex justify-end gap-2">
          {canEdit && onRemove && (
            <Button
              variant="danger"
              onClick={onRemove}
              className="mr-auto"
              aria-label={t({
                id: "feedback.remove",
                message: "Remove",
              })}
            >
              <Trans id="feedback.remove">Remove</Trans>
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={onClose}
            aria-label={t({
              id: "cloudFilePicker.close",
              message: "Close",
            })}
          >
            <Trans id="cloudFilePicker.close">Close</Trans>
          </Button>
          {canEdit && (
            <Button
              variant="primary"
              onClick={handleEdit}
              aria-label={t({
                id: "Edit",
                message: "Edit",
              })}
            >
              <Trans id="Edit">Edit</Trans>
            </Button>
          )}
        </div>
      </div>
    </ModalBase>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
FeedbackViewDialog.displayName = "FeedbackViewDialog";
