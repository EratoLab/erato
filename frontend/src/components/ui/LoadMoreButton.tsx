import clsx from "clsx";
import React, { memo } from "react";

import { Button } from "./Button";
import { SpinnerIcon } from "./SpinnerIcon";

interface LoadMoreButtonProps {
  /**
   * Click handler for the button
   */
  onClick: () => void;

  /**
   * Whether the data is currently loading
   */
  isLoading?: boolean;

  /**
   * Custom label for the button
   */
  label?: string;

  /**
   * Custom loading label for the button
   */
  loadingLabel?: string;

  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * Whether to make the button sticky at the top
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
        "flex justify-center py-2 bg-theme-bg-secondary",
        className,
      )}
    >
      <Button
        onClick={onClick}
        disabled={isLoading}
        variant="secondary"
        size="sm"
        className="px-4 rounded-full"
        icon={isLoading ? <SpinnerIcon size="sm" /> : undefined}
      >
        {isLoading ? loadingLabel : label}
      </Button>
    </div>
  ),
);

LoadMoreButton.displayName = "LoadMoreButton";
