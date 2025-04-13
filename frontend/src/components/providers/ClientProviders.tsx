"use client";

import { ApiProvider } from "./ApiProvider";
import { ThemeProvider } from "./ThemeProvider";

import type { PropsWithChildren } from "react";

/**
 * Provider component that wraps the entire application
 * with all necessary providers in the correct order
 */
export function ClientProviders({ children }: PropsWithChildren) {
  return (
    <ApiProvider>
      <ThemeProvider>
        <div className="flex h-screen min-h-screen bg-theme-bg-primary">
          {children}
        </div>
      </ThemeProvider>
    </ApiProvider>
  );
}
