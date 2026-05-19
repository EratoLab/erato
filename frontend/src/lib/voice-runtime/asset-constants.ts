/* eslint-disable lingui/no-unlocalized-strings -- this module is path/URL plumbing only; no user-facing text */

export const VOICE_RUNTIME_DIRECTORY = "voice-runtime";
export const VOICE_RUNTIME_MANIFEST_FILENAME = "manifest.json";
export const RICKY0123_VAD_ASSET_DIRECTORY = "ricky0123-vad-web";
export const ONNX_RUNTIME_WEB_ASSET_DIRECTORY = "onnxruntime-web";
export const RICKY0123_VAD_WORKLET_FILENAME = "vad.worklet.bundle.min.js";
export const SILERO_VAD_LEGACY_MODEL_FILENAME = "silero_vad_legacy.onnx";
export const SILERO_VAD_V5_MODEL_FILENAME = "silero_vad_v5.onnx";
export const RICKY0123_VAD_DIST_FILES = [
  RICKY0123_VAD_WORKLET_FILENAME,
  SILERO_VAD_LEGACY_MODEL_FILENAME,
  SILERO_VAD_V5_MODEL_FILENAME,
] as const;
