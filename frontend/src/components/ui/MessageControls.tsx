import React from "react";
import clsx from "clsx";
import { Button } from "./Button";
import {
  ClipboardDocumentIcon,
  HandThumbUpIcon,
  HandThumbDownIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";

interface MessageControlsProps {
  /** Whether the message is from the user */
  isUser: boolean;
  /** Whether to show controls only on hover */
  showOnHover?: boolean;
  /** Callback when copy button is clicked */
  onCopy?: () => void;
  /** Callback when edit button is clicked (user messages only) */
  onEdit?: () => void;
  /** Callback when like button is clicked (assistant messages only) */
  onLike?: () => void;
  /** Callback when dislike button is clicked (assistant messages only) */
  onDislike?: () => void;
  /** Callback when regenerate button is clicked (assistant messages only) */
  onRerun?: () => void;
  /** Additional CSS classes */
  className?: string;
}

export const MessageControls = ({
  isUser,
  showOnHover = false,
  onCopy,
  onEdit,
  onLike,
  onDislike,
  onRerun,
  className,
}: MessageControlsProps) => {
  return (
    <div
      className={clsx(
        "flex items-center gap-2",
        showOnHover && "opacity-0 group-hover:opacity-100 transition-opacity",
        className,
      )}
    >
      {onCopy && (
        <Button
          onClick={onCopy}
          icon={<ClipboardDocumentIcon />}
          size="sm"
          aria-label="Copy message"
          title="Copy message"
        />
      )}
      {isUser && (
        <Button
          onClick={onEdit}
          icon={<ClipboardDocumentIcon />}
          size="sm"
          aria-label="Edit message"
          title="Edit message"
        />
      )}
      {!isUser && (
        <>
          {onLike && (
            <Button
              onClick={onLike}
              icon={<HandThumbUpIcon />}
              size="sm"
              aria-label="Like message"
              title="Like message"
            />
          )}
          {onDislike && (
            <Button
              onClick={onDislike}
              icon={<HandThumbDownIcon />}
              size="sm"
              aria-label="Dislike message"
              title="Dislike message"
            />
          )}
          {onRerun && (
            <Button
              onClick={onRerun}
              icon={<ArrowPathIcon />}
              size="sm"
              aria-label="Regenerate response"
              title="Regenerate response"
            />
          )}
        </>
      )}
    </div>
  );
};

MessageControls.displayName = "MessageControls";
