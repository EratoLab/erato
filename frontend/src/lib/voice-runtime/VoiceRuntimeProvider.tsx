import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";

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

export function VoiceRuntimeProvider({
  children,
  voiceRuntimeAssets,
}: VoiceRuntimeProviderProps) {
  const resolvedAssets = useMemo(
    () => resolveVoiceRuntimeAssets(voiceRuntimeAssets),
    [voiceRuntimeAssets],
  );

  return (
    <VoiceRuntimeAssetsContext.Provider value={resolvedAssets}>
      {children}
    </VoiceRuntimeAssetsContext.Provider>
  );
}

export function useVoiceRuntimeAssets(): VoiceRuntimeAssets {
  return useContext(VoiceRuntimeAssetsContext) ?? resolveVoiceRuntimeAssets();
}
