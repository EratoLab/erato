import { useEffect, useRef } from "react";

/**
 * Hook to detect clicks outside of a referenced element
 * @param ref - Reference to the element to detect clicks outside of
 * @param handler - Callback to execute when a click outside is detected
 * @param enabled - Whether the hook is enabled
 */
export const useClickOutside = (
  ref: React.RefObject<HTMLElement | null>,
  handler: () => void,
  enabled = true,
) => {
  const handlerRef = useRef<() => void>(handler);
  const processingRef = useRef<boolean>(false);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Keep handler reference up to date
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Early returns for various conditions
      if (processingRef.current) {
        return;
      }

      if (target.closest('[role="menuitem"]')) {
        return;
      }

      if (!ref.current?.contains(target)) {
        processingRef.current = true;

        // Cleanup existing timeout
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        // Delay execution to allow other click handlers to complete
        timeoutRef.current = setTimeout(() => {
          handlerRef.current();
          processingRef.current = false;
        }, 50);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [ref, enabled]);
};
