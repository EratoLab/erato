/**
 * Side-effect-only provider — deliberately does not expose its own React
 * context, unlike the other providers in this directory. It reads the
 * Office.js theme via `useOfficeTheme` and feeds the resulting light/dark
 * value to `ThemeProvider` as the "system" theme override. While the user
 * keeps `themeMode === "system"`, the surrounding Office host defines the
 * effective theme; explicit Light/Dark selections in the settings dialog
 * remain user choices and are not overwritten here.
 */
import { useTheme } from "@erato/frontend/library";
import { useEffect, type ReactNode } from "react";

import { useOfficeTheme } from "../hooks/useOfficeTheme";

export function OfficeThemeProvider({ children }: { children: ReactNode }) {
  const { mode } = useOfficeTheme();
  const { setSystemThemeOverride } = useTheme();

  useEffect(() => {
    setSystemThemeOverride(mode ?? null);
  }, [mode, setSystemThemeOverride]);

  return <>{children}</>;
}
