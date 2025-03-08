import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import React, { memo, useEffect, useState } from "react";
import { useUpdateEffect } from "react-use";

interface MessageTimestampProps {
  createdAt: Date;
  className?: string;
  displayStyle?: "time" | "relative";
  /**
   * Enable auto-updates for relative timestamps
   * @default false
   */
  autoUpdate?: boolean;
}

// Update intervals based on time difference
const getUpdateInterval = (diff: number): number => {
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return 1000; // Update every second if less than a minute ago
  if (diff < hour) return minute; // Update every minute if less than an hour ago
  if (diff < day) return hour; // Update every hour if less than a day ago
  return day; // Update daily
};

export const MessageTimestamp = memo(function MessageTimestamp({
  createdAt,
  className,
  displayStyle = "relative",
  autoUpdate = false,
}: MessageTimestampProps) {
  const [now, setNow] = useState<number>(() => Date.now());
  const [timeString, setTimeString] = useState(() =>
    displayStyle === "time"
      ? createdAt.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })
      : formatDistanceToNow(createdAt, {
          addSuffix: true,
          includeSeconds: true,
        }),
  );

  // Fix: Properly manage the dependencies to prevent infinite rerenders
  // by memoizing the condition outside of the dependency array
  const shouldUpdateOnNowChange = displayStyle === "relative";

  useUpdateEffect(() => {
    setTimeString(
      displayStyle === "time"
        ? createdAt.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })
        : formatDistanceToNow(createdAt, {
            addSuffix: true,
            includeSeconds: true,
          }),
    );
  }, [createdAt, displayStyle, shouldUpdateOnNowChange && now]);

  useEffect(() => {
    if (!autoUpdate || displayStyle === "time") return;

    const diff = Date.now() - createdAt.getTime();
    const interval = getUpdateInterval(diff);

    const timer = setInterval(() => {
      setNow(Date.now());
    }, interval);

    return () => clearInterval(timer);
  }, [createdAt, displayStyle, autoUpdate]);

  return (
    <time
      className={clsx("block text-xs text-theme-fg-muted", className)}
      dateTime={createdAt.toISOString()}
      title={createdAt.toLocaleString()}
    >
      {timeString}
    </time>
  );
});
