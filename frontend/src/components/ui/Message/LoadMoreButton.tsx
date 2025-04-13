import clsx from "clsx";
import React, { memo } from "react";

import { Button } from "../Controls/Button";
import { SpinnerIcon } from "../Feedback/SpinnerIcon";

interface LoadMoreButtonProps {
  /**
   * Function to call when the button is clicked
   */
  onClick: () => void;

  /**
   * Whether messages are currently loading
   */
  isPending?: boolean;

  /**
   * Custom label for the button
   */
  label?: string;

  /**
   * Custom label when loading
   */
  loadingLabel?: string;

  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * Whether the button should stick to the top of the container
   */
  isSticky?: boolean;
}

/**
 * Button for loading more messages
 */
export const LoadMoreButton = memo(
  ({
    onClick,
    isPending = false,
    label = "Load older messages",
    loadingLabel = "Loading...",
    className,
    isSticky = false,
  }: LoadMoreButtonProps) => {
    return (
      <div
        className={clsx(
          "flex w-full justify-center p-2",
          {
            "sticky top-0 z-10 bg-theme-bg": isSticky,
          },
          className,
        )}
      >
        <Button
          variant="secondary"
          size="sm"
          onClick={onClick}
          disabled={isPending}
          className={clsx("rounded-full px-4")}
          icon={isPending ? <SpinnerIcon size="sm" /> : undefined}
        >
          {isPending ? loadingLabel : label}
        </Button>
      </div>
    );
  },
);

LoadMoreButton.displayName = "LoadMoreButton";
