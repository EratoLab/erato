import { useCallback, useEffect, useRef } from "react";

import { toast } from "./toast";

import type { ToastInput } from "./types";

/**
 * Error toasts that belong to the page showing them: any still up when the page
 * unmounts are dismissed, since they describe a form or list the user has left.
 * An error raised after the page is gone (a request that fails later) stays.
 */
export function usePageErrorToast() {
  const ids = useRef(new Set<string>());

  useEffect(() => {
    const shown = ids.current;
    return () => {
      shown.forEach((id) => toast.dismiss(id));
      shown.clear();
    };
  }, []);

  return useCallback((input: Omit<ToastInput, "variant">) => {
    const id = toast.error(input);
    ids.current.add(id);
    return id;
  }, []);
}
