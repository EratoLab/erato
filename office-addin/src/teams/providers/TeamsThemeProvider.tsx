/**
 * Feeds the host theme in as the "system" override, so an explicit Light/Dark
 * pick in settings still wins. Mirrors `OfficeThemeProvider`.
 */
import { useTheme } from "@erato/frontend/library";
import { useEffect, type ReactNode } from "react";

import { useTeams } from "./TeamsProvider";

export function TeamsThemeProvider({ children }: { children: ReactNode }) {
  const { theme } = useTeams();
  const { setSystemThemeOverride } = useTheme();

  useEffect(() => {
    if (theme === null) {
      setSystemThemeOverride(null);
      return;
    }
    setSystemThemeOverride(theme === "default" ? "light" : "dark");
  }, [theme, setSystemThemeOverride]);

  return <>{children}</>;
}
