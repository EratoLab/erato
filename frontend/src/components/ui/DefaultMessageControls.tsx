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
        showOnHover && "opacity-0 group-hover:opacity-100 theme-transition",
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
                onClick={() => handleAction("rerun")}
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
      <MessageTimestamp createdAt={createdAt} />
    </div>
  );
};
