import React, { memo } from "react";
import clsx from "clsx";

interface MessageTimestampProps {
  createdAt: Date;
  className?: string;
}

export const MessageTimestamp = memo(function MessageTimestamp({
  createdAt,
  className,
}: MessageTimestampProps) {
  return (
    <time
      className={clsx("text-xs text-theme-fg-muted block", className)}
      dateTime={createdAt.toISOString()}
      title={createdAt.toLocaleString()}
    >
      {createdAt.toLocaleTimeString()}
    </time>
  );
});
