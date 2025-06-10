import clsx from "clsx";
import { useCallback, useEffect } from "react";

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

/**
 * Hook to inject animation keyframes into the document
 */
export const useMessageAnimations = () => {
  useEffect(() => {
    // Only inject if not already present
    if (!document.getElementById("message-animations")) {
      const style = document.createElement("style");
      style.id = "message-animations";
      // eslint-disable-next-line lingui/no-unlocalized-strings
      style.innerHTML = `
        @keyframes fadeIn {
          from { opacity: 0.7; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.5s ease-out forwards;
        }
      `;
      document.head.appendChild(style);
    }

    // Clean up on unmount
    return () => {
      const style = document.getElementById("message-animations");
      if (style) {
        document.head.removeChild(style);
      }
    };
  }, []);
};
