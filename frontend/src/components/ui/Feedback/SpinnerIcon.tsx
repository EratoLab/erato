import clsx from "clsx";
import React, { memo } from "react";

interface SpinnerIconProps {
  /**
   * Size of the spinner in pixels
   */
  size?: "sm" | "md" | "lg";

  /**
   * Additional CSS classes to apply
   */
  className?: string;

  /**
   * Optional text for screen readers
   */
  srText?: string;
}

/**
 * A reusable spinner icon component for loading states
 */
export const SpinnerIcon = memo<SpinnerIconProps>(
  ({ size = "md", className, srText = "Loading..." }) => {
    const sizeClasses = {
      sm: "h-3 w-3",
      md: "h-4 w-4",
      lg: "h-6 w-6",
    };

    return (
      <div
        className={clsx(
          "text-theme-text-secondary inline-block animate-spin rounded-full border-2 border-solid border-current border-e-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]",
          sizeClasses[size],
          className,
        )}
        role="status"
      >
        <span className="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]">
          {srText}
        </span>
      </div>
    );
  },
);

SpinnerIcon.displayName = "SpinnerIcon";
