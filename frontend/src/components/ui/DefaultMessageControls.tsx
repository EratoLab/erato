import React from "react";
import clsx from "clsx";
import { Button } from "./Button";
import { MessageTimestamp } from "./MessageTimestamp";
import {
  ClipboardDocumentIcon,
  HandThumbUpIcon,
  HandThumbDownIcon,
  ArrowPathIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import {
  MessageControlsProps,
  MessageActionType,
} from "../../types/message-controls";

export const DefaultMessageControls = ({
  messageId,
  messageType,
  authorId,
  context,
  showOnHover = false,
  onAction,
  className,
  createdAt,
}: MessageControlsProps) => {
  const isUser = messageType === "user";
  const isOwnMessage = authorId === context.currentUserId;
  const isDialogOwner = context.currentUserId === context.dialogOwnerId;

  const handleAction = (type: MessageActionType) => {
    onAction({ type, messageId });
  };

  return (
    <div
      className={clsx(
        "flex items-center gap-2",
        showOnHover && "opacity-0 group-hover:opacity-100 transition-opacity",
        className,
      )}
    >
      <MessageTimestamp createdAt={createdAt} />

      <div className="flex items-center gap-2">
        <Button
          onClick={() => handleAction("copy")}
          icon={<ClipboardDocumentIcon />}
          size="sm"
          aria-label="Copy message"
          title="Copy message"
        />

        {isUser && isOwnMessage && !context.isSharedDialog && (
          <Button
            onClick={() => handleAction("edit")}
            icon={<PencilSquareIcon />}
            size="sm"
            aria-label="Edit message"
            title="Edit message"
          />
        )}

        {!isUser && (
          <>
            <Button
              onClick={() => handleAction("like")}
              icon={<HandThumbUpIcon />}
              size="sm"
              aria-label="Like message"
              title="Like message"
            />
            <Button
              onClick={() => handleAction("dislike")}
              icon={<HandThumbDownIcon />}
              size="sm"
              aria-label="Dislike message"
              title="Dislike message"
            />
            {(isOwnMessage || isDialogOwner) && (
              <Button
                onClick={() => handleAction("rerun")}
                icon={<ArrowPathIcon />}
                size="sm"
                aria-label="Regenerate response"
                title="Regenerate response"
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};
