import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { memo, useEffect, useState } from "react";
import { useUpdateEffect } from "react-use";

import { useDateFnsLocale } from "@/hooks/useDateFnsLocale";

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
      t`Invalid date provided to MessageTimestamp, using current date`,
    );
    return new Date();
  }
};

export const MessageTimestamp = memo(function MessageTimestamp({
  createdAt,
  className,
  displayStyle = "relative",
  autoUpdate = false,
}: MessageTimestampProps) {
  // Ensure we have a valid date object
  const safeCreatedAt = ensureValidDate(createdAt);

  // Get the date-fns locale based on the current i18n locale
  const dateFnsLocale = useDateFnsLocale();

  const [now, setNow] = useState<number>(() => Date.now());
  const [timeString, setTimeString] = useState(() =>
    displayStyle === "time"
      ? safeCreatedAt.toLocaleTimeString(undefined, {
          hour: "2-digit", // eslint-disable-line lingui/no-unlocalized-strings
          minute: "2-digit", // eslint-disable-line lingui/no-unlocalized-strings
        })
      : formatDistanceToNow(safeCreatedAt, {
          addSuffix: true,
          includeSeconds: true,
          locale: dateFnsLocale,
        }),
  );

  // Fix: Properly manage the dependencies to prevent infinite rerenders
  // by memoizing the condition outside of the dependency array
  const shouldUpdateOnNowChange = displayStyle === "relative";

  useUpdateEffect(() => {
    setTimeString(
      displayStyle === "time"
        ? safeCreatedAt.toLocaleTimeString(undefined, {
            hour: "2-digit", // eslint-disable-line lingui/no-unlocalized-strings
            minute: "2-digit", // eslint-disable-line lingui/no-unlocalized-strings
          })
        : formatDistanceToNow(safeCreatedAt, {
            addSuffix: true,
            includeSeconds: true,
            locale: dateFnsLocale,
          }),
    );
  }, [
    safeCreatedAt,
    displayStyle,
    shouldUpdateOnNowChange && now,
    dateFnsLocale,
  ]);

  useEffect(() => {
    if (!autoUpdate || displayStyle === "time") return;

    const diff = Date.now() - safeCreatedAt.getTime();
    const interval = getUpdateInterval(diff);

    const timer = setInterval(() => {
      setNow(Date.now());
    }, interval);

    return () => clearInterval(timer);
  }, [safeCreatedAt, displayStyle, autoUpdate]);

  return (
    <time
      className={clsx("block text-xs text-theme-fg-muted", className)}
      dateTime={safeCreatedAt.toISOString()}
      title={safeCreatedAt.toLocaleString()}
    >
      {timeString}
    </time>
  );
});
