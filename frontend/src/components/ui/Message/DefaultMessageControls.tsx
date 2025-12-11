"use client";

import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useState, useEffect, useCallback } from "react";

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

import type { MessageFeedback } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type {
  // MessageAction,
  MessageControlsProps,
} from "@/types/message-controls";

const logger = createLogger("UI", "DefaultMessageControls");

interface ExtendedMessageControlsProps extends MessageControlsProps {
  showFeedbackButtons?: boolean;
  showFeedbackComments?: boolean;
  showRawMarkdown?: boolean;
  onToggleRawMarkdown?: () => void;
  /** Initial feedback state from API (existing feedback for this message) */
  initialFeedback?: MessageFeedback;
  hasToolCalls?: boolean;
}

export const DefaultMessageControls = ({
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
}: ExtendedMessageControlsProps) => {
  const [isCopied, setIsCopied] = useState(false);
  // Initialize feedback state from existing feedback if present
  const [feedbackState, setFeedbackState] = useState<
    "liked" | "disliked" | null
  >(() => {
    if (initialFeedback) {
      return initialFeedback.sentiment === "positive" ? "liked" : "disliked";
    }
    return null;
  });
  // Chat-level edit permission from context; default true if unspecified
  const canEditChat = context.canEdit !== false; // default to true if unspecified
  // const isDialogOwner = context.dialogOwnerId === profile.profile?.id;

  // Sync feedback state when initial feedback changes (e.g., message list refresh)
  useEffect(() => {
    if (initialFeedback) {
      setFeedbackState(
        initialFeedback.sentiment === "positive" ? "liked" : "disliked",
      );
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
    [onAction, messageId],
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
              showRawMarkdown ? t`Show formatted` : t`Show raw markdown`
            }
            title={showRawMarkdown ? t`Show formatted` : t`Show raw markdown`}
            className={showRawMarkdown ? "text-theme-fg-accent" : ""}
          />
        )}

        <Button
          disabled={isCopied}
          onClick={() => void handleAction("copy")}
          variant="icon-only"
          icon={
            isCopied ? <CheckIcon className="text-green-500" /> : <CopyIcon />
          }
          size="sm"
          showOnHover={showOnHover}
          aria-label={t`Copy message`}
          title={t`Copy message`}
        />

        {isUser && canEditChat && !context.isSharedDialog && (
          <Button
            onClick={() => void handleAction("edit")}
            variant="icon-only"
            icon={<EditIcon />}
            size="sm"
            showOnHover={showOnHover}
            aria-label={t`Edit message`}
            title={t`Edit message`}
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
                      ? "fill-green-500 text-green-500"
                      : ""
                  }
                />
              }
              size="sm"
              showOnHover={feedbackState === null ? showOnHover : false}
              aria-label={t`Like message`}
              title={
                feedbackState === "liked"
                  ? t`You found this helpful`
                  : t`Like message`
              }
              disabled={feedbackState !== null}
              className={feedbackState === "liked" ? "opacity-100" : ""}
            />
            <Button
              onClick={() => void handleAction("dislike")}
              variant="icon-only"
              icon={
                <ThumbDownIcon
                  className={
                    feedbackState === "disliked"
                      ? "fill-red-500 text-red-500"
                      : ""
                  }
                />
              }
              size="sm"
              showOnHover={feedbackState === null ? showOnHover : false}
              aria-label={t`Dislike message`}
              title={
                feedbackState === "disliked"
                  ? t`You found this unhelpful`
                  : t`Dislike message`
              }
              disabled={feedbackState !== null}
              className={feedbackState === "disliked" ? "opacity-100" : ""}
            />
          </>
        )}
      </div>

      {/* Timestamp */}
      <MessageTimestamp createdAt={safeCreatedAt} />
    </div>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
DefaultMessageControls.displayName = "DefaultMessageControls";
