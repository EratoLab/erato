"use client";

import { ApiProvider } from "@/components/providers/ApiProvider";
import { ThemeProvider } from "@/components/providers/ThemeProvider";

import { ChatProvider } from "./ChatProvider";

import type { FileType } from "@/utils/fileTypes";
import type { ReactNode } from "react";

interface RootProviderProps {
  children: ReactNode;
  acceptedFileTypes?: FileType[];
}

/**
 * Root provider that combines all application providers
 *
 * This component wraps the entire application with all necessary providers
 * in the correct order based on dependencies between them.
 */
export function RootProvider({
  children,
  acceptedFileTypes = [],
}: RootProviderProps) {
  return (
    <ApiProvider>
      <ThemeProvider>
        <ChatProvider acceptedFileTypes={acceptedFileTypes}>
          {children}
        </ChatProvider>
      </ThemeProvider>
    </ApiProvider>
  );
}
