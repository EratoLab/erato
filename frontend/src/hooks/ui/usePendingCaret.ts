import { useCallback, useLayoutEffect, useReducer, useRef } from "react";

import type { RefObject } from "react";

interface PendingCaret {
  text: string;
  caret: number;
}

/**
 * Focuses a controlled textarea and places its caret, in the same commit that
 * puts `text` into it.
 *
 * Writing a textarea's value moves its caret to the end, so code that rewrites
 * the draft has to put the caret back. Doing that a frame later races the
 * user: keys typed in between go in at the end, and the late caret move then
 * puts the following keys in front of them. A layout effect runs before the
 * browser can deliver the next key.
 *
 * The write is skipped when the textarea no longer holds `text`, so it never
 * moves a caret that the user's own typing has placed since.
 */
export function usePendingCaret(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
) {
  const pendingRef = useRef<PendingCaret | null>(null);
  // A request that leaves the text unchanged still needs a commit to land in.
  const [request, bumpRequest] = useReducer((count: number) => count + 1, 0);

  useLayoutEffect(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    const textarea = textareaRef.current;
    if (!pending || textarea?.value !== pending.text) {
      return;
    }
    if (document.activeElement !== textarea) {
      textarea.focus();
    }
    textarea.setSelectionRange(pending.caret, pending.caret);
  }, [request, textareaRef]);

  return useCallback((text: string, caret: number) => {
    pendingRef.current = { text, caret };
    bumpRequest();
  }, []);
}
