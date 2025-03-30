"use client";

import { ThemeProvider } from "./ThemeProvider";

import type { PropsWithChildren } from "react";

export function ClientProviders({ children }: PropsWithChildren) {
  return (
    <ThemeProvider>
      <div className="flex h-screen min-h-screen bg-theme-bg-primary">
        {children}
      </div>
    </ThemeProvider>
  );
}
