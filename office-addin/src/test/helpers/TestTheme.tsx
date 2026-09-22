import { ThemeProvider } from "@erato/frontend/library";

import type { PropsWithChildren } from "react";

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
