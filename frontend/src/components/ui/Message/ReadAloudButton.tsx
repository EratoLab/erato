"use client";

import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { memo } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { toggleReadAloud, useReadAloud } from "@/hooks/audio/readAloud";
import { useMessageActionsFeature } from "@/providers/FeatureConfigProvider";

import { SpeakerIcon, StopIcon, WarningCircleIcon } from "../icons";

import type { MessageReadAloudFacts } from "@/types/message-controls";

export interface ReadAloudButtonProps {
  messageId: string;
  /** Hide until the message is hovered, like the buttons next to it. */
  showOnHover?: boolean;
  /**
   * The `readAloud` value of the message controls props, passed through
   * unchanged. The button stays hidden while it is missing.
   */
  readAloud?: MessageReadAloudFacts;
  className?: string;
}

/**
 * Reads one assistant message aloud and turns into a stop button meanwhile.
 * Decides on its own whether it shows: message controls only have to render
 * it and pass the three props through.
 */
export const ReadAloudButton = memo(function ReadAloudButton({
  messageId,
  showOnHover = false,
  readAloud,
  className,
}: ReadAloudButtonProps) {
  const { readAloudEnabled } = useMessageActionsFeature();
  const audioModeActive = useReadAloud((state) => state.audioModeActive);
  const status = useReadAloud((state) =>
    state.messageId === messageId ? state.status : null,
  );

  if (
    !readAloudEnabled ||
    audioModeActive ||
    !readAloud?.isFinished ||
    !readAloud.hasText ||
    readAloud.hasSpokenAudio
  ) {
    return null;
  }

  const isActive = status === "loading" || status === "playing";
  const label = isActive
    ? t({ id: "message.readAloud.stop.aria", message: "Stop reading" })
    : status === "failed"
      ? t({
          id: "message.readAloud.failed",
          message: "Could not read this message aloud. Try again",
        })
      : t({ id: "message.readAloud.aria", message: "Read aloud" });

  return (
    <Button
      onClick={() => toggleReadAloud(messageId)}
      variant="icon-only"
      icon={
        status === "playing" ? (
          <StopIcon className="p-0.5" />
        ) : status === "failed" ? (
          <WarningCircleIcon className="text-theme-error-fg" />
        ) : (
          <SpeakerIcon />
        )
      }
      size="sm"
      busy={status === "loading"}
      showOnHover={status === null ? showOnHover : false}
      aria-label={label}
      title={label}
      data-ui="message-read-aloud"
      data-state={status ?? "idle"}
      className={clsx(
        "hover:bg-[var(--theme-message-controls)] focus-visible:bg-[var(--theme-message-controls)]",
        status !== null && "opacity-100",
        className,
      )}
    />
  );
});
