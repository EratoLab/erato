import { useEffect, useState } from "react";

import { useOffice } from "../providers/OfficeProvider";
import {
  detectTheme,
  type OfficeThemeSnapshot,
} from "../utils/officeTheme/detectTheme";
import { subscribeThemeChanges } from "../utils/officeTheme/subscribeThemeChanges";

export interface UseOfficeThemeResult {
  mode: "light" | "dark" | null;
  colors: OfficeThemeSnapshot["colors"] | null;
}

const EMPTY: UseOfficeThemeResult = { mode: null, colors: null };

/**
 * Reads the current Office theme and subscribes to host-provided theme changes.
 *
 * Returns `{ mode: null, colors: null }` until the Office provider is ready or
 * when `Office.context.officeTheme` is unavailable. All Office.js access is
 * delegated to `utils/officeTheme/*` — this hook has no direct Office.context
 * reads.
 */
export function useOfficeTheme(): UseOfficeThemeResult {
  const { isReady, host } = useOffice();
  const [snapshot, setSnapshot] = useState<OfficeThemeSnapshot | null>(null);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    let cancelled = false;

    const initial = detectTheme(host);
    if (!cancelled) {
      setSnapshot(initial);
    }

    const unsubscribe = subscribeThemeChanges(host, (next) => {
      if (cancelled) return;
      setSnapshot(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isReady, host]);

  if (!isReady || !snapshot) {
    return EMPTY;
  }

  return { mode: snapshot.mode, colors: snapshot.colors };
}
