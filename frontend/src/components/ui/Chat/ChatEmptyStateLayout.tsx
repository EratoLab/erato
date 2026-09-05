import clsx from "clsx";

import type { ReactNode } from "react";

export type ChatEmptyStateLayoutMode = "centered" | "bottom" | "conversation";

export interface ChatEmptyStateLayoutProps {
  mode: ChatEmptyStateLayoutMode;
  above: ReactNode;
  composer: ReactNode;
  below: ReactNode;
  className?: string;
}

const shellHooks: Record<ChatEmptyStateLayoutMode, string> = {
  centered: "chat-empty-state-centered-shell",
  bottom: "chat-empty-state-bottom-shell",
  conversation: "chat-conversation-shell",
};

/**
 * The three-row frame around the composer. All three rows exist in every
 * mode so the composer keeps one DOM position while the surrounding
 * content changes; only the row classes differ.
 */
export function ChatEmptyStateLayout({
  mode,
  above,
  composer,
  below,
  className,
}: ChatEmptyStateLayoutProps) {
  const centered = mode === "centered";

  return (
    <div
      className={clsx(
        centered
          ? "grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] py-4 sm:py-6"
          : "flex min-h-0 flex-1 flex-col",
        className,
      )}
      data-ui={shellHooks[mode]}
    >
      <div
        className={clsx(
          centered && "flex min-h-0 flex-col overflow-y-auto px-2 sm:px-4",
          mode === "bottom" &&
            "flex min-h-0 flex-1 flex-col items-center overflow-y-auto pb-6 pt-10 sm:pt-16",
          mode === "conversation" && "relative flex min-h-0 flex-1 flex-col",
        )}
        data-ui="welcome-above"
      >
        {centered ? (
          // `mt-auto` bottom-aligns short content but collapses to zero once
          // the content overflows, so the row still scrolls from its top;
          // `justify-end` would push the overflow above the scrollable area.
          <div className="mt-auto flex w-full flex-col items-center pb-6">
            {above}
          </div>
        ) : (
          above
        )}
      </div>
      <div className="w-full shrink-0" data-ui="composer-cluster">
        {composer}
      </div>
      <div
        className={
          centered
            ? "flex min-h-0 flex-col items-center overflow-y-auto px-2 sm:px-4"
            : "shrink-0"
        }
        data-ui="welcome-below"
      >
        {below}
      </div>
    </div>
  );
}
