"use client";

import { ApiProvider } from "./ApiProvider";
import { ThemeProvider } from "./ThemeProvider";
import { I18nProvider } from "../../providers/I18nProvider";

import type { PropsWithChildren } from "react";

/**
 * Provider component that wraps the entire application
 * with all necessary providers in the correct order
 */
export function ClientProviders({ children }: PropsWithChildren) {
  return (
    <ApiProvider>
      <ThemeProvider>
        <I18nProvider>
          <div className="flex h-screen min-h-screen bg-theme-bg-primary">
            {children}
          </div>
        </I18nProvider>
      </ThemeProvider>
    </ApiProvider>
  );
}
