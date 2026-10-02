import { useEffect } from "react";

import { runWordInPlaceProbe } from "../utils/wordInPlaceProbe";

type ProbeWindow = { eratoWordInPlaceProbe?: typeof runWordInPlaceProbe };

/**
 * Dev-only console surface for the in-place writer's native checks. Open an empty scratch document
 * and run `await eratoWordInPlaceProbe()`; the result holds only booleans, counts and codes.
 */
export function useWordInPlaceDevProbe(): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (globalThis as ProbeWindow).eratoWordInPlaceProbe = runWordInPlaceProbe;
    console.log(
      "[erato] eratoWordInPlaceProbe ready: run it in an empty scratch document",
    );
    return () => {
      delete (globalThis as ProbeWindow).eratoWordInPlaceProbe;
    };
  }, []);
}
