import clsx from "clsx";
import React, { memo } from "react";

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
          return "Beginning of conversation";
        case "end":
          return "End of conversation";
        case "empty":
          return "No messages yet";
        default:
          return "";
      }
    };

    return (
      <div
        className={clsx(
          "text-theme-text-secondary flex justify-center py-2 text-xs",
          className,
        )}
      >
        <span>{text ?? getDefaultText()}</span>
      </div>
    );
  },
);

ConversationIndicator.displayName = "ConversationIndicator";
