import React, { memo } from "react";

interface MessageTimestampProps {
  createdAt: Date;
}

export const MessageTimestamp = memo(function MessageTimestamp({
  createdAt,
}: MessageTimestampProps) {
  return (
    <time
      className="text-xs text-theme-fg-muted mt-2 block"
      dateTime={createdAt.toISOString()}
      title={createdAt.toLocaleString()}
    >
      {createdAt.toLocaleTimeString()}
    </time>
  );
});
