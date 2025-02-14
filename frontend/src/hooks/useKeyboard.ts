import { useEffect } from "react";

interface UseKeyboardProps {
  target: React.RefObject<HTMLElement | null>;
  enabled?: boolean;
  onEscape?: (e: KeyboardEvent) => void;
  onTab?: (e: KeyboardEvent) => void;
  onEnter?: (e: KeyboardEvent) => void;
}

export const useKeyboard = ({
  target,
  enabled = true,
  onEscape,
  onTab,
  onEnter,
}: UseKeyboardProps) => {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          onEscape?.(e);
          break;
        case "Tab":
          onTab?.(e);
          break;
        case "Enter":
          onEnter?.(e);
          break;
      }
    };

    const element = target.current || document;
    element.addEventListener("keydown", handleKeyDown);
    return () => element.removeEventListener("keydown", handleKeyDown);
  }, [target, enabled, onEscape, onTab, onEnter]);
};
