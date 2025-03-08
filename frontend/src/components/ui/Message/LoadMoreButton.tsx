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
  isLoading?: boolean;

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
 * A specialized button for loading more content in paginated lists
 */
export const LoadMoreButton = memo<LoadMoreButtonProps>(
  ({
    onClick,
    isLoading = false,
    label = "Load more messages",
    loadingLabel = "Loading...",
    className,
    isSticky = true,
  }) => (
    <div
      className={clsx(
        isSticky && "sticky top-0 z-10",
        "mt-2 flex justify-center py-4",
        "after:absolute after:inset-x-0 after:bottom-0 after:-z-10 after:h-6 after:bg-gradient-to-b after:from-transparent after:to-theme-bg-secondary after:opacity-50 after:content-['']",
        className,
      )}
    >
      <Button
        onClick={onClick}
        disabled={isLoading}
        variant="primary"
        size="sm"
        className="rounded-full px-4 shadow-md transition-all hover:shadow-lg"
        icon={isLoading ? <SpinnerIcon size="sm" /> : undefined}
      >
        {isLoading ? loadingLabel : label}
      </Button>
    </div>
  ),
);

LoadMoreButton.displayName = "LoadMoreButton";
