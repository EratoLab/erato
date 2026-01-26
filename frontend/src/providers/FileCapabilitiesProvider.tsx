import { createContext, useContext, type ReactNode } from "react";

import { useFileCapabilities } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { FileCapability } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface FileCapabilitiesContextType {
  capabilities: FileCapability[];
  isLoading: boolean;
  error: unknown;
}

const FileCapabilitiesContext = createContext<
  FileCapabilitiesContextType | undefined
>(undefined);

export function FileCapabilitiesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { data, isLoading, error } = useFileCapabilities(
    {},
    {
      staleTime: Infinity, // File capabilities don't change during session
      retry: 1,
      refetchOnWindowFocus: false, // No need to refetch
    },
  );

  return (
    <FileCapabilitiesContext.Provider
      value={{
        capabilities: data ?? [],
        isLoading,
        error,
      }}
    >
      {children}
    </FileCapabilitiesContext.Provider>
  );
}

export function useFileCapabilitiesContext() {
  const context = useContext(FileCapabilitiesContext);
  if (!context) {
    throw new Error(
      "useFileCapabilitiesContext must be used within FileCapabilitiesProvider",
    );
  }
  return context;
}
