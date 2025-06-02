"use client";

import {
  ClipboardDocumentIcon,
  HandThumbUpIcon,
  HandThumbDownIcon,
  PencilSquareIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import React, { useState, useEffect, useCallback } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { MessageTimestamp } from "@/components/ui/Message/MessageTimestamp";
import { useProfile } from "@/hooks/useProfile";
import { createLogger } from "@/utils/debugLogger";

import type {
  // MessageAction,
  MessageControlsProps,
} from "@/types/message-controls";

const logger = createLogger("UI", "DefaultMessageControls");

export const DefaultMessageControls = ({
  messageId,
  // messageType,
  authorId,
  createdAt,
  context,
  showOnHover = false,
  onAction,
  className,
  isUserMessage,
  showFeedbackButtons = false,
}: MessageControlsProps & { showFeedbackButtons?: boolean }) => {
  const [isCopied, setIsCopied] = useState(false);
  const [feedbackState, setFeedbackState] = useState<
    "liked" | "disliked" | null
  >(null);
  const profile = useProfile();

  const isOwnMessage = authorId === profile.profile?.id;
  // const isDialogOwner = context.dialogOwnerId === profile.profile?.id;

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
        <Button
          disabled={isCopied}
          onClick={() => void handleAction("copy")}
          variant="icon-only"
          icon={
            isCopied ? (
              <CheckIcon className="text-green-500" />
            ) : (
              <ClipboardDocumentIcon />
            )
          }
          size="sm"
          showOnHover={showOnHover}
          aria-label="Copy message"
          title="Copy message"
        />

        {isUser && isOwnMessage && !context.isSharedDialog && (
          <Button
            onClick={() => void handleAction("edit")}
            variant="icon-only"
            icon={<PencilSquareIcon />}
            size="sm"
            showOnHover={showOnHover}
            aria-label="Edit message"
            title="Edit message"
            disabled={feedbackState !== null}
          />
        )}

        {!isUser && showFeedbackButtons && (
          <>
            <Button
              onClick={() => void handleAction("like")}
              variant="icon-only"
              icon={
                feedbackState === "liked" ? (
                  <CheckIcon className="text-green-500" />
                ) : (
                  <HandThumbUpIcon />
                )
              }
              size="sm"
              showOnHover={showOnHover}
              aria-label="Like message"
              title="Like message"
              disabled={feedbackState !== null}
            />
            <Button
              onClick={() => void handleAction("dislike")}
              variant="icon-only"
              icon={
                feedbackState === "disliked" ? (
                  <CheckIcon className="text-red-500" />
                ) : (
                  <HandThumbDownIcon />
                )
              }
              size="sm"
              showOnHover={showOnHover}
              aria-label="Dislike message"
              title="Dislike message"
              disabled={feedbackState !== null}
            />
          </>
        )}
      </div>
      <MessageTimestamp createdAt={safeCreatedAt} />
    </div>
  );
};

DefaultMessageControls.displayName = "DefaultMessageControls";
