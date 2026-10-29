import clsx from "clsx";
import { useCallback } from "react";

/**
 * Helper function to create CSS class names for message highlighting
 */
export const useMessageClassNameHelper = () => {
  return useCallback(
    (isNew: boolean) =>
      clsx(
        "mx-auto w-full",
        "py-4",
        "transition-all duration-700 ease-in-out",
        isNew
          ? "border-l-4 border-theme-border-focus bg-theme-bg-hover pl-2"
          : "bg-transparent",
      ),
    [],
  );
};
