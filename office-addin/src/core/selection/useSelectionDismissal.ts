import { useCallback, useState } from "react";

export interface SelectionDismissal {
  dismissed: boolean;
  dismiss: () => void;
  rearm: () => void;
}

/**
 * Dismissing the selection chip lasts until the user selects something else.
 * The previous key is tracked on every change, not only on re-arm: otherwise
 * deselecting and then selecting the same passage again would read as
 * "unchanged" and the dismissal would stick (ERMAIN-431). An empty key means
 * nothing is selected. A context change (another conversation or document)
 * always clears the dismissal.
 */
export function useSelectionDismissal(
  selectionKey: string,
  contextKey: string,
): SelectionDismissal {
  const [state, setState] = useState({
    selectionKey,
    contextKey,
    dismissed: false,
  });
  let current = state;
  if (state.contextKey !== contextKey) {
    current = { selectionKey, contextKey, dismissed: false };
  } else if (state.selectionKey !== selectionKey) {
    current = {
      selectionKey,
      contextKey,
      dismissed: selectionKey === "" && state.dismissed,
    };
  }
  if (current !== state) setState(current);

  const dismiss = useCallback(() => {
    setState((previous) =>
      previous.dismissed ? previous : { ...previous, dismissed: true },
    );
  }, []);
  const rearm = useCallback(() => {
    setState((previous) =>
      previous.dismissed ? { ...previous, dismissed: false } : previous,
    );
  }, []);

  return { dismissed: current.dismissed, dismiss, rearm };
}
