import { t } from "@lingui/core/macro";

/** Well-known action facet arg keys used for display purposes. */
export const ACTION_FACET_ARG_KEYS = {
  // eslint-disable-next-line lingui/no-unlocalized-strings
  SELECTED_TEXT: "selected_text",
} as const;

interface ActionFacetContextProps {
  actionFacetArgs?: Record<string, string>;
}

/**
 * Renders a quote block showing the contextual text that was sent alongside
 * an action facet request (e.g., selected text from Outlook compose, cell
 * content from Excel). Displays any arg named `selected_text` as a blockquote.
 *
 * Returns null when no displayable context is present.
 */
export function ActionFacetContext({
  actionFacetArgs,
}: ActionFacetContextProps) {
  const selectedText = actionFacetArgs?.[ACTION_FACET_ARG_KEYS.SELECTED_TEXT];

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
      <div className="line-clamp-3 text-sm text-theme-fg-secondary">
        {selectedText}
      </div>
    </div>
  );
}
