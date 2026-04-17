/**
 * Side-effect-only provider — deliberately does not expose its own React
 * context, unlike the other providers in this directory. It reads the
 * Office.js theme via `useOfficeTheme` and pushes the resulting mode into
 * the frontend `ThemeProvider` through `setThemeMode`. The redundant-mode
 * guard prevents unnecessary re-renders.
 */
import { useTheme } from "@erato/frontend/library";
import { useEffect, type ReactNode } from "react";

import { useOfficeTheme } from "../hooks/useOfficeTheme";

export function OfficeThemeProvider({ children }: { children: ReactNode }) {
  const { mode } = useOfficeTheme();
  const { themeMode, setThemeMode } = useTheme();

  useEffect(() => {
    if (mode && mode !== themeMode) {
      setThemeMode(mode);
    }
  }, [mode, themeMode, setThemeMode]);

  return <>{children}</>;
}
