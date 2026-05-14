import {
  resolveVoiceRuntimeAssets,
  type VoiceRuntimeAssetOverrides,
} from "./assets";

export type Ricky0123VadAssetOptions = {
  baseAssetPath: string;
  onnxWASMBasePath: string;
};

export function createRicky0123VadAssetOptions(
  assets: VoiceRuntimeAssetOverrides | string = {},
): Ricky0123VadAssetOptions {
  const resolved = resolveVoiceRuntimeAssets(assets);
  return {
    baseAssetPath: resolved.ricky0123Vad.baseAssetPath,
    onnxWASMBasePath: resolved.ricky0123Vad.onnxWASMBasePath,
  };
}
