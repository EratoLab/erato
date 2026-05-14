"use client";

import { createContext, use, useMemo, type PropsWithChildren } from "react";

import {
  resolveVoiceRuntimeAssets,
  type VoiceRuntimeAssetOverrides,
  type VoiceRuntimeAssets,
} from "./assets";

export type VoiceRuntimeProviderProps = PropsWithChildren<{
  voiceRuntimeAssets?: VoiceRuntimeAssetOverrides | string;
}>;

const VoiceRuntimeAssetsContext = createContext<VoiceRuntimeAssets | null>(
  null,
);

let cachedDefaultAssets: VoiceRuntimeAssets | null = null;
function getDefaultVoiceRuntimeAssets(): VoiceRuntimeAssets {
  if (typeof window === "undefined") {
    return resolveVoiceRuntimeAssets();
  }
  cachedDefaultAssets ??= resolveVoiceRuntimeAssets();
  return cachedDefaultAssets;
}

export function __resetDefaultVoiceRuntimeAssetsForTests(): void {
  cachedDefaultAssets = null;
}

export function VoiceRuntimeProvider({
  children,
  voiceRuntimeAssets,
}: VoiceRuntimeProviderProps) {
  const resolvedAssets = useMemo(() => {
    if (voiceRuntimeAssets === undefined) {
      return getDefaultVoiceRuntimeAssets();
    }
    return resolveVoiceRuntimeAssets(voiceRuntimeAssets);
  }, [voiceRuntimeAssets]);

  return (
    <VoiceRuntimeAssetsContext.Provider value={resolvedAssets}>
      {children}
    </VoiceRuntimeAssetsContext.Provider>
  );
}

export function useVoiceRuntimeAssets(): VoiceRuntimeAssets {
  return use(VoiceRuntimeAssetsContext) ?? getDefaultVoiceRuntimeAssets();
}
