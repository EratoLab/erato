import {
  resolveVoiceRuntimeAssets,
  type VoiceRuntimeAssetOverrides,
  type VoiceRuntimeAssets,
} from "./assets";

export type Ricky0123VadAssetOptions = {
  baseAssetPath: string;
  onnxWASMBasePath: string;
};

function isResolvedVoiceRuntimeAssets(
  value: VoiceRuntimeAssetOverrides | VoiceRuntimeAssets | string | undefined,
): value is VoiceRuntimeAssets {
  return (
    typeof value === "object" &&
    value !== null &&
    "ricky0123Vad" in value &&
    "manifestUrl" in value
  );
}

export function createRicky0123VadAssetOptions(
  assets: VoiceRuntimeAssetOverrides | VoiceRuntimeAssets | string = {},
): Ricky0123VadAssetOptions {
  const resolvedAssets = isResolvedVoiceRuntimeAssets(assets)
    ? assets
    : resolveVoiceRuntimeAssets(assets);

  return {
    baseAssetPath: resolvedAssets.ricky0123Vad.baseAssetPath,
    onnxWASMBasePath: resolvedAssets.ricky0123Vad.onnxWASMBasePath,
  };
}
