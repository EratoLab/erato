import { useCallback, useEffect, useRef, useState } from "react";

const CLEAR_AFTER_MS = 4000;
const ZERO_WIDTH_SPACE = "\u200b";

/**
 * Text for one polite live region. Cleared after a few seconds so the region
 * does not keep stale words; a repeat of the current text gets an invisible
 * suffix, because a region only speaks when its content changes.
 */
export const useLiveAnnouncement = (): [string, (text: string) => void] => {
  const [text, setText] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const announce = useCallback((next: string) => {
    if (!next) {
      return;
    }
    setText((current) =>
      current === next ? `${next}${ZERO_WIDTH_SPACE}` : next,
    );
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => setText(""), CLEAR_AFTER_MS);
  }, []);

  return [text, announce];
};
