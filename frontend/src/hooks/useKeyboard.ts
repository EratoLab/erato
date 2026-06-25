import { useEffect } from "react";

interface UseKeyboardProps {
  target: React.RefObject<HTMLElement | null>;
  enabled?: boolean;
  onEscape?: (e: KeyboardEvent) => void;
  onTab?: (e: KeyboardEvent) => void;
  onEnter?: (e: KeyboardEvent) => void;
  onArrowDown?: (e: KeyboardEvent) => void;
  onArrowUp?: (e: KeyboardEvent) => void;
  onHome?: (e: KeyboardEvent) => void;
  onEnd?: (e: KeyboardEvent) => void;
}

export const useKeyboard = ({
  target,
  enabled = true,
  onEscape,
  onTab,
  onEnter,
  onArrowDown,
  onArrowUp,
  onHome,
  onEnd,
}: UseKeyboardProps) => {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: Event) => {
      const keyEvent = e as KeyboardEvent;
      switch (keyEvent.key) {
        case "Escape":
          onEscape?.(keyEvent);
          break;
        case "Tab":
          onTab?.(keyEvent);
          break;
        case "Enter":
          onEnter?.(keyEvent);
          break;
        case "ArrowDown":
          onArrowDown?.(keyEvent);
          break;
        case "ArrowUp":
          onArrowUp?.(keyEvent);
          break;
        case "Home":
          onHome?.(keyEvent);
          break;
        case "End":
          onEnd?.(keyEvent);
          break;
      }
    };

    const element = target.current ?? document;
    element.addEventListener("keydown", handleKeyDown);
    return () => element.removeEventListener("keydown", handleKeyDown);
  }, [
    target,
    enabled,
    onEscape,
    onTab,
    onEnter,
    onArrowDown,
    onArrowUp,
    onHome,
    onEnd,
  ]);
};
