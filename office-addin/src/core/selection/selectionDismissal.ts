export interface SelectionDismissalState {
  selectionKey: string;
  contextKey: string;
  dismissed: boolean;
}

/**
 * Dismissing a selection lasts until the user selects something else. The
 * previous key is tracked on every change, not only on re-arm: otherwise
 * deselecting and then selecting the same passage again would read as
 * "unchanged" and the dismissal would stick (ERMAIN-431). An empty key means
 * nothing is selected. A context change (another conversation or document)
 * always clears the dismissal.
 */
export function nextSelectionDismissal(
  state: SelectionDismissalState,
  selectionKey: string,
  contextKey: string,
): SelectionDismissalState {
  if (state.contextKey !== contextKey)
    return { selectionKey, contextKey, dismissed: false };
  if (state.selectionKey !== selectionKey)
    return {
      selectionKey,
      contextKey,
      dismissed: selectionKey === "" && state.dismissed,
    };
  return state;
}
