import { useCallback, useState } from "react";

import { nextSelectionDismissal } from "./selectionDismissal";

export interface SelectionDismissal {
  dismissed: boolean;
  dismiss: () => void;
  rearm: () => void;
}

/** The dismissal rules of `nextSelectionDismissal`, in component state. */
export function useSelectionDismissal(
  selectionKey: string,
  contextKey: string,
): SelectionDismissal {
  const [state, setState] = useState({
    selectionKey,
    contextKey,
    dismissed: false,
  });
  const current = nextSelectionDismissal(state, selectionKey, contextKey);
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
