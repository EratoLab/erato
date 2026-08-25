import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { memo } from "react";

import { TranscriptNotice } from "./TranscriptNotice";

interface ConversationIndicatorProps {
  /**
   * The type of indicator to show
   */
  type: "beginning" | "end" | "empty";

  /**
   * Custom text to display
   */
  text?: string;

  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * A component that displays various conversation boundary indicators
 */
export const ConversationIndicator = memo<ConversationIndicatorProps>(
  ({ type, text, className }) => {
    const getDefaultText = () => {
      switch (type) {
        case "beginning":
          return t`Beginning of conversation`;
        case "end":
          return t`End of conversation`;
        case "empty":
          return t`No messages yet`;
        default:
          return "";
      }
    };

    return (
      <TranscriptNotice
        className={clsx("py-2 text-theme-fg-secondary", className)}
      >
        {text ?? getDefaultText()}
      </TranscriptNotice>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
ConversationIndicator.displayName = "ConversationIndicator";
