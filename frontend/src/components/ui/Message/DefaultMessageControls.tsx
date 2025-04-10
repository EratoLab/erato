"use client";

import {
  ClipboardDocumentIcon,
  HandThumbUpIcon,
  HandThumbDownIcon,
  ArrowPathIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import React from "react";

import { MessageTimestamp } from "./MessageTimestamp";
import { Button } from "../Controls/Button";

import type {
  MessageControlsProps,
  MessageAction,
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
  const isUser =
    isUserMessage !== undefined ? isUserMessage : messageType === "user";
  const isOwnMessage = authorId === context.currentUserId;
  const isDialogOwner = context.currentUserId === context.dialogOwnerId;

  // Ensure createdAt is a valid Date object
  const safeCreatedAt = ensureValidDate(createdAt);

  // Handle message actions
  const handleAction = (action: MessageAction) => {
    void onAction(action);
  };

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
          onClick={() => handleAction("copy")}
          variant="icon-only"
          icon={<ClipboardDocumentIcon />}
          size="sm"
          showOnHover={showOnHover}
          aria-label="Copy message"
          title="Copy message"
        />

        {isUser && isOwnMessage && !context.isSharedDialog && (
          <Button
            onClick={() => handleAction("edit")}
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
              onClick={() => handleAction("like")}
              variant="icon-only"
              icon={<HandThumbUpIcon />}
              size="sm"
              showOnHover={showOnHover}
              aria-label="Like message"
              title="Like message"
            />
            <Button
              onClick={() => handleAction("dislike")}
              variant="icon-only"
              icon={<HandThumbDownIcon />}
              size="sm"
              showOnHover={showOnHover}
              aria-label="Dislike message"
              title="Dislike message"
            />
            {(isOwnMessage || isDialogOwner) && (
              <Button
                onClick={() => handleAction("regenerate")}
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
