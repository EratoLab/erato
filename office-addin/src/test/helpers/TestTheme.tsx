import { ThemeProvider } from "@erato/frontend/library";

import type { PropsWithChildren } from "react";

/** Exercise shared themed components without loading a deployment's theme. */
export function TestTheme({ children }: PropsWithChildren) {
  return (
    <ThemeProvider
      enableCustomTheme={false}
      initialThemeMode="light"
      persistThemeMode={false}
      persistTextSize={false}
    >
      {children}
    </ThemeProvider>
  );
}
