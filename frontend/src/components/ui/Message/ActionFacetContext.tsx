import { t } from "@lingui/core/macro";
import { useMemo } from "react";

import {
  WordCommentSentContext,
  wordCommentContextSent,
} from "@/components/ui/WordReview/WordCommentContextView";
import { wordKeptMarkersLabelled } from "@/components/ui/WordReview/wordKeptMarkerLabels";
import { parseWordCommentContext } from "@/lib/wordReview/wordCommentContext";
import { parseWordKeptItems } from "@/lib/wordReview/wordSelectionReply";

/** Well-known action facet arg keys used for display purposes. */
export const ACTION_FACET_ARG_KEYS = {
  // eslint-disable-next-line lingui/no-unlocalized-strings
  SELECTED_TEXT: "selected_text",
  // eslint-disable-next-line lingui/no-unlocalized-strings
  KEPT_ITEMS: "kept_items",
} as const;

interface ActionFacetContextProps {
  actionFacetArgs?: Record<string, string>;
}

/**
 * Renders a quote block showing the contextual text that was sent alongside
 * an action facet request (e.g., selected text from Outlook compose, cell
 * content from Excel). Displays any arg named `selected_text` as a blockquote,
 * one line per paragraph, with the markers a `kept_items` arg explains
 * labelled as the Word add-in labels them. Word comment context the request
 * carried gets a "Sent context" line; a malformed comment argument shows none.
 *
 * Returns null when no displayable context is present.
 */
export function ActionFacetContext({
  actionFacetArgs,
}: ActionFacetContextProps) {
  const selectedText = actionFacetArgs?.[ACTION_FACET_ARG_KEYS.SELECTED_TEXT];
  const keptItems = actionFacetArgs?.[ACTION_FACET_ARG_KEYS.KEPT_ITEMS];
  const parsed = useMemo(
    () => parseWordCommentContext(actionFacetArgs),
    [actionFacetArgs],
  );
  const comments = parsed && wordCommentContextSent(parsed) ? parsed : null;

  if (!selectedText && !comments) {
    return null;
  }

  return (
    <div className="mb-2 flex flex-col gap-1 rounded-md border-l-2 border-theme-border bg-theme-bg-secondary px-3 py-2">
      {selectedText && (
        <div>
          <div className="mb-0.5 text-xs font-medium text-theme-fg-muted">
            {t({
              id: "chat.message.action_facet.selection_label",
              message: "Selection",
            })}
          </div>
          <div className="line-clamp-3 whitespace-pre-line text-sm text-theme-fg-secondary">
            {keptItems
              ? wordKeptMarkersLabelled(
                  selectedText,
                  parseWordKeptItems(keptItems),
                )
              : selectedText}
          </div>
        </div>
      )}
      {comments && <WordCommentSentContext context={comments} />}
    </div>
  );
}
