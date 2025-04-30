"use client";

import { ChatProvider } from "./ChatProvider";
import { ProfileProvider } from "./ProfileProvider";

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
    <ProfileProvider>
      <ChatProvider acceptedFileTypes={acceptedFileTypes}>
        {children}
      </ChatProvider>
    </ProfileProvider>
  );
}
