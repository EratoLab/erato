import { t } from "@lingui/core/macro";

import { wordKeptMarkersLabelled } from "@/components/ui/WordReview/wordKeptMarkerLabels";
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
 * labelled as the Word add-in labels them.
 *
 * Returns null when no displayable context is present.
 */
export function ActionFacetContext({
  actionFacetArgs,
}: ActionFacetContextProps) {
  const selectedText = actionFacetArgs?.[ACTION_FACET_ARG_KEYS.SELECTED_TEXT];
  const keptItems = actionFacetArgs?.[ACTION_FACET_ARG_KEYS.KEPT_ITEMS];

  if (!selectedText) {
    return null;
  }

  return (
    <div className="mb-2 rounded-md border-l-2 border-theme-border bg-theme-bg-secondary px-3 py-2">
      <div className="mb-0.5 text-xs font-medium text-theme-fg-muted">
        {t({
          id: "chat.message.action_facet.selection_label",
          message: "Selection",
        })}
      </div>
      <div className="line-clamp-3 whitespace-pre-line text-sm text-theme-fg-secondary">
        {keptItems
          ? wordKeptMarkersLabelled(selectedText, parseWordKeptItems(keptItems))
          : selectedText}
      </div>
    </div>
  );
}
