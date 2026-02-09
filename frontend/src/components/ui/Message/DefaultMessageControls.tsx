"use client";

import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { memo, useState, useEffect, useCallback } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { MessageTimestamp } from "@/components/ui/Message/MessageTimestamp";
import { createLogger } from "@/utils/debugLogger";

import {
  CopyIcon,
  ThumbUpIcon,
  ThumbDownIcon,
  EditIcon,
  CheckIcon,
  CodeIcon,
} from "../icons";

import type { MessageControlsProps } from "@/types/message-controls";

const logger = createLogger("UI", "DefaultMessageControls");

export const DefaultMessageControls = memo(function DefaultMessageControls({
  messageId,
  // messageType,
  authorId: _authorId,
  createdAt,
  context,
  showOnHover = false,
  onAction,
  className,
  isUserMessage,
  showFeedbackButtons = false,
  showFeedbackComments: _showFeedbackComments = false,
  showRawMarkdown = false,
  onToggleRawMarkdown,
  initialFeedback,
  hasToolCalls = false,
  onViewFeedback,
}: MessageControlsProps) {
  const [isCopied, setIsCopied] = useState(false);

  // Chat-level edit permission from context; default true if unspecified
  const canEditChat = context.canEdit !== false; // default to true if unspecified
  // const isDialogOwner = context.dialogOwnerId === profile.profile?.id;

  // Derive feedback state from initialFeedback prop
  // This avoids unnecessary re-renders from useEffect + useState combination
  const [feedbackState, setFeedbackState] = useState<
    "liked" | "disliked" | null
  >(() => {
    if (initialFeedback) {
      return initialFeedback.sentiment === "positive" ? "liked" : "disliked";
    }
    return null;
  });

  // Sync feedbackState when initialFeedback changes (e.g., after cache invalidation)
  useEffect(() => {
    if (initialFeedback) {
      const newState =
        initialFeedback.sentiment === "positive" ? "liked" : "disliked";
      setFeedbackState(newState);
    }
  }, [initialFeedback]);

  useEffect(() => {
    if (isCopied) {
      const timer = setTimeout(() => {
        setIsCopied(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isCopied]);

  const handleAction = useCallback(
    async (actionType: "copy" | "edit" | "like" | "dislike") => {
      // Determine if user is clicking the same sentiment they already submitted
      const isClickingSameSentiment =
        (actionType === "like" && feedbackState === "liked") ||
        (actionType === "dislike" && feedbackState === "disliked");

      // If feedback already exists and user clicks the SAME filled button, show view dialog
      if (
        (actionType === "like" || actionType === "dislike") &&
        feedbackState !== null &&
        initialFeedback &&
        onViewFeedback &&
        isClickingSameSentiment
      ) {
        onViewFeedback(messageId, initialFeedback);
        return;
      }

      // Prevent duplicate feedback submissions if already submitted but cache not yet updated
      // This handles the case where feedbackState is set locally but initialFeedback hasn't arrived yet
      // ONLY prevent if clicking the same sentiment (allow changing sentiment)
      if (
        (actionType === "like" || actionType === "dislike") &&
        feedbackState !== null &&
        isClickingSameSentiment
      ) {
        logger.log(
          `Feedback already submitted for message ${messageId}, waiting for cache update`,
        );
        return;
      }

      const success = await onAction({
        type: actionType,
        messageId,
      });

      if (success) {
        if (actionType === "copy") {
          setIsCopied(true);
        } else if (actionType === "like") {
          setFeedbackState("liked");
        } else if (actionType === "dislike") {
          setFeedbackState("disliked");
        }
        logger.log(`Action '${actionType}' succeeded for message ${messageId}`);
      } else {
        logger.log(`Action '${actionType}' failed for message ${messageId}`);
      }
    },
    [onAction, messageId, feedbackState, initialFeedback, onViewFeedback],
  );

  // Ensure safeCreatedAt is always a Date object
  const safeCreatedAt =
    createdAt instanceof Date ? createdAt : new Date(createdAt ?? Date.now());
  const isUser = isUserMessage;

  return (
    <div
      className={clsx(
        "flex items-center gap-2",
        showOnHover && "theme-transition opacity-0 group-hover:opacity-100",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {/* Raw/Formatted toggle - always visible for any message */}
        {onToggleRawMarkdown && (
          <Button
            onClick={onToggleRawMarkdown}
            variant="icon-only"
            icon={<CodeIcon />}
            size="sm"
            showOnHover={showOnHover}
            aria-label={
              showRawMarkdown
                ? t({
                    id: "message.showFormatted.aria",
                    message: "Show formatted",
                  })
                : t({
                    id: "message.showRawMarkdown.aria",
                    message: "Show raw markdown",
                  })
            }
            title={
              showRawMarkdown
                ? t({
                    id: "message.showFormatted.aria",
                    message: "Show formatted",
                  })
                : t({
                    id: "message.showRawMarkdown.aria",
                    message: "Show raw markdown",
                  })
            }
            className={showRawMarkdown ? "text-theme-fg-accent" : ""}
          />
        )}

        <Button
          disabled={isCopied}
          onClick={() => void handleAction("copy")}
          variant="icon-only"
          icon={
            isCopied ? (
              <CheckIcon className="text-theme-success-fg" />
            ) : (
              <CopyIcon />
            )
          }
          size="sm"
          showOnHover={showOnHover}
          aria-label={t({ id: "message.copy.aria", message: "Copy message" })}
          title={t({ id: "message.copy.aria", message: "Copy message" })}
        />

        {isUser && canEditChat && !context.isSharedDialog && (
          <Button
            onClick={() => void handleAction("edit")}
            variant="icon-only"
            icon={<EditIcon />}
            size="sm"
            showOnHover={showOnHover}
            aria-label={t({ id: "message.edit.aria", message: "Edit message" })}
            title={t({ id: "message.edit.aria", message: "Edit message" })}
            disabled={feedbackState !== null}
          />
        )}

        {!isUser && showFeedbackButtons && (
          <>
            <Button
              onClick={() => void handleAction("like")}
              variant="icon-only"
              icon={
                <ThumbUpIcon
                  className={
                    feedbackState === "liked"
                      ? "fill-theme-success-fg text-theme-success-fg"
                      : ""
                  }
                />
              }
              size="sm"
              showOnHover={feedbackState === null ? showOnHover : false}
              aria-label={t({
                id: "feedback.like.aria",
                message: "Like message",
              })}
              title={
                feedbackState === "liked"
                  ? t({
                      id: "feedback.like.active",
                      message: "You found this helpful",
                    })
                  : t({ id: "feedback.like.aria", message: "Like message" })
              }
              disabled={false}
              className={feedbackState === "liked" ? "opacity-100" : ""}
            />
            <Button
              onClick={() => void handleAction("dislike")}
              variant="icon-only"
              icon={
                <ThumbDownIcon
                  className={
                    feedbackState === "disliked"
                      ? "fill-theme-error-fg text-theme-error-fg"
                      : ""
                  }
                />
              }
              size="sm"
              showOnHover={feedbackState === null ? showOnHover : false}
              aria-label={t({
                id: "feedback.dislike.aria",
                message: "Dislike message",
              })}
              title={
                feedbackState === "disliked"
                  ? t({
                      id: "feedback.dislike.active",
                      message: "You found this unhelpful",
                    })
                  : t({
                      id: "feedback.dislike.aria",
                      message: "Dislike message",
                    })
              }
              disabled={false}
              className={feedbackState === "disliked" ? "opacity-100" : ""}
            />
          </>
        )}
      </div>

      {/* Timestamp */}
      <MessageTimestamp createdAt={safeCreatedAt} />
    </div>
  );
});
