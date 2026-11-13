import { useLayoutEffect, type RefObject } from "react";

import {
  rangeFromMessageTextAnchor,
  type MessageTextAnchor,
} from "./messageTextBlocks";

/** Styled by `::highlight(erato-explain-passage)` in globals.css. */
const HIGHLIGHT_NAME = "erato-explain-passage";

/**
 * Keeps the explained passage marked while its card is open, through the CSS
 * Custom Highlight API, which paints ranges without touching the rendered
 * markdown. A browser without it shows the card with no mark.
 */
export function useExplainPassageHighlight(
  rootRef: RefObject<HTMLElement | null>,
  anchor: MessageTextAnchor | null,
) {
  // No dependency list: the range points at text nodes, and any commit of the
  // message may have replaced them.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (
      !anchor ||
      !root ||
      typeof CSS === "undefined" ||
      !("highlights" in CSS) ||
      typeof Highlight === "undefined"
    ) {
      return;
    }
    const range = rangeFromMessageTextAnchor(root, anchor);
    if (!range) {
      return;
    }
    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range));
    return () => {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    };
  });
}
