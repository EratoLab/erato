import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { memo } from "react";

import { Button } from "../Controls/Button";

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
    label = t`Load older messages`,
    loadingLabel = t`Loading...`,
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
          loading={isPending}
          shape="pill"
          className="px-4"
        >
          {isPending ? loadingLabel : label}
        </Button>
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
LoadMoreButton.displayName = "LoadMoreButton";
