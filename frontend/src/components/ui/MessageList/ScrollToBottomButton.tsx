import { plural, t } from "@lingui/core/macro";
import { memo, useEffect, useState } from "react";

import { ChevronDownIcon } from "../icons";

interface ScrollToBottomButtonProps {
  onClick: () => void;
  newMessageCount: number;
}

/**
 * A floating button that appears at the bottom of the message list when new
 * messages arrive while the user is scrolled away from the bottom. Clicking it
 * scrolls the view to the latest messages.
 */
export const ScrollToBottomButton = memo(
  ({ onClick, newMessageCount }: ScrollToBottomButtonProps) => {
    // Defer setting visible by one tick so the CSS transition fires on mount
    const [visible, setVisible] = useState(false);
    useEffect(() => {
      const timer = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(timer);
    }, []);

    // The visible count is the button's accessible name, so voice control
    // users can say what they see.
    const label = t({
      id: "messageList.scrollToBottom.newMessageCount",
      message: plural(newMessageCount, {
        one: "# new message",
        other: "# new messages",
      }),
    });

    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
        <button
          type="button"
          onClick={onClick}
          className={[
            "pointer-events-auto",
            "flex items-center gap-1.5",
            "rounded-full px-3.5 py-1.5",
            "text-sm font-medium",
            "bg-[var(--theme-shell-chat-body)] text-[var(--theme-fg-primary)]",
            "border border-[var(--theme-border-subtle,var(--theme-border))]",
            "shadow-[0_2px_8px_rgba(0,0,0,0.12)]",
            "transition-[opacity,transform] duration-200 ease-out",
            "hover:bg-[var(--theme-bg-secondary)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.16)]",
            "active:scale-95",
            visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
          ].join(" ")}
        >
          <span>{label}</span>
          <ChevronDownIcon
            aria-hidden="true"
            className="size-3.5"
            strokeWidth={2}
          />
        </button>
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
ScrollToBottomButton.displayName = "ScrollToBottomButton";
