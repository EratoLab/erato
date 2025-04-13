"use client";

import {
  ClipboardDocumentIcon,
  HandThumbUpIcon,
  HandThumbDownIcon,
  ArrowPathIcon,
  PencilSquareIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import React, { useState, useEffect, useRef } from "react";

import { MessageTimestamp } from "./MessageTimestamp";
import { Button } from "../Controls/Button";

import type {
  MessageControlsProps,
  MessageActionType,
} from "../../../types/message-controls";

/**
 * Safely ensures a valid Date object
 * Returns current date if input is invalid
 */
const ensureValidDate = (dateInput: unknown): Date => {
  if (dateInput instanceof Date) {
    return isNaN(dateInput.getTime()) ? new Date() : dateInput;
  }

  try {
    const dateObj = new Date(dateInput as string | number);
    return isNaN(dateObj.getTime()) ? new Date() : dateObj;
  } catch {
    console.warn(
      "Invalid date provided to DefaultMessageControls, using current date",
    );
    return new Date();
  }
};

export const DefaultMessageControls = ({
  messageId: _messageId,
  messageType,
  authorId,
  context,
  showOnHover = false,
  onAction,
  className,
  createdAt,
  isUserMessage,
}: MessageControlsProps) => {
  // Support both isUserMessage (new) and messageType (legacy)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- isUserMessage can be undefined based on props type
  const isUser = isUserMessage ?? messageType === "user";
  const isOwnMessage = authorId === context.currentUserId;
  const isDialogOwner = context.currentUserId === context.dialogOwnerId;

  // Ensure createdAt is a valid Date object
  const safeCreatedAt = ensureValidDate(createdAt);

  // Handle message actions
  const [isCopied, setIsCopied] = useState(false);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleAction = async (actionType: MessageActionType) => {
    // Pass the full action object including the messageId
    const success = await onAction({ type: actionType, messageId: _messageId });
    if (actionType === "copy" && success) {
      setIsCopied(true);
      // Clear previous timeout if exists
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    }
  };

  // Effect to reset the copy icon after a delay
  useEffect(() => {
    if (isCopied) {
      copyTimeoutRef.current = setTimeout(() => {
        setIsCopied(false);
      }, 2000); // Reset after 2 seconds
    }

    // Cleanup timeout on unmount or if isCopied changes before timeout fires
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, [isCopied]);

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
          // Disable button briefly after successful copy
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
          />
        )}

        {!isUser && (
          <>
            <Button
              onClick={() => void handleAction("like")}
              variant="icon-only"
              icon={<HandThumbUpIcon />}
              size="sm"
              showOnHover={showOnHover}
              aria-label="Like message"
              title="Like message"
            />
            <Button
              onClick={() => void handleAction("dislike")}
              variant="icon-only"
              icon={<HandThumbDownIcon />}
              size="sm"
              showOnHover={showOnHover}
              aria-label="Dislike message"
              title="Dislike message"
            />
            {(isOwnMessage || isDialogOwner) && (
              <Button
                onClick={() => void handleAction("regenerate")}
                variant="icon-only"
                icon={<ArrowPathIcon />}
                size="sm"
                showOnHover={showOnHover}
                aria-label="Regenerate response"
                title="Regenerate response"
              />
            )}
          </>
        )}
      </div>
      <MessageTimestamp createdAt={safeCreatedAt} />
    </div>
  );
};
