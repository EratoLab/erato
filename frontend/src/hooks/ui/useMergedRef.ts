import { useCallback } from "react";

import type React from "react";

/** Points a forwarded ref, callback or object, at `node`. */
export function assignRef<T>(
  ref: React.ForwardedRef<T> | undefined,
  node: T | null,
) {
  if (typeof ref === "function") {
    ref(node);
  } else if (ref) {
    ref.current = node;
  }
}

/**
 * One callback ref that fills a component's own ref and the ref its caller
 * forwarded, for a component that needs its element and exposes it too.
 */
export function useMergedRef<T>(
  own: React.MutableRefObject<T | null>,
  forwarded: React.ForwardedRef<T> | undefined,
) {
  return useCallback(
    (node: T | null) => {
      own.current = node;
      assignRef(forwarded, node);
    },
    [own, forwarded],
  );
}
