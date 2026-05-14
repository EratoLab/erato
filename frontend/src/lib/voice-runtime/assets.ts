export const VOICE_RUNTIME_DIRECTORY = "voice-runtime";
export const VOICE_RUNTIME_MANIFEST_FILENAME = "manifest.json";
export const RICKY0123_VAD_ASSET_DIRECTORY = "ricky0123-vad-web";
export const ONNX_RUNTIME_WEB_ASSET_DIRECTORY = "onnxruntime-web";

export type VoiceRuntimeAssetOverrides = {
  /**
   * Directory that hosts this runtime's manifest plus engine assets.
   * Defaults to `${FRONTEND_PUBLIC_BASE_PATH}/voice-runtime`.
   */
  basePath?: string;
  manifestUrl?: string;
  ricky0123Vad?: Partial<Ricky0123VadRuntimeAssets>;
};

export type Ricky0123VadRuntimeManifest = {
  baseAssetPath: string;
  onnxWASMBasePath: string;
  worklet: string;
  sileroVadLegacyModel: string;
  sileroVadV5Model: string;
};

export type VoiceRuntimeManifest = {
  version: 1;
  engines: {
    ricky0123Vad: Ricky0123VadRuntimeManifest;
  };
};

export type Ricky0123VadRuntimeAssets = {
  /**
   * Passed to `@ricky0123/vad-web` as `baseAssetPath`.
   * Hosts the VAD worklet and Silero ONNX model files.
   */
  baseAssetPath: string;
  /**
   * Passed to `@ricky0123/vad-web` as `onnxWASMBasePath`.
   * Hosts the onnxruntime-web WASM runtime files.
   */
  onnxWASMBasePath: string;
  workletUrl: string;
  sileroVadLegacyModelUrl: string;
  sileroVadV5ModelUrl: string;
};

export type VoiceRuntimeAssets = {
  basePath: string;
  manifestUrl: string;
  ricky0123Vad: Ricky0123VadRuntimeAssets;
};

declare global {
  interface Window {
    VOICE_RUNTIME_BASE_PATH?: string;
  }
}

function maybeValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function normalizeVoiceRuntimeBasePath(basePath: string): string {
  const trimmed = basePath.trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }

  return trimmed.replace(/\/+$/, "");
}

export function joinVoiceRuntimePath(
  basePath: string,
  ...segments: string[]
): string {
  const normalizedBasePath = normalizeVoiceRuntimeBasePath(basePath);
  const normalizedSegments = segments
    .map((segment) => segment.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");

  if (!normalizedSegments) {
    return normalizedBasePath || "/";
  }

  return normalizedBasePath
    ? `${normalizedBasePath}/${normalizedSegments}`
    : `/${normalizedSegments}`;
}

export function joinVoiceRuntimeDirectory(
  basePath: string,
  ...segments: string[]
): string {
  return `${joinVoiceRuntimePath(basePath, ...segments)}/`;
}

export function getDefaultVoiceRuntimeBasePath(): string {
  const importMetaEnv = import.meta.env as Record<string, unknown>;
  const windowEnv = typeof window === "undefined" ? undefined : window;
  const explicitVoiceRuntimeBasePath =
    maybeValue(importMetaEnv.VITE_VOICE_RUNTIME_BASE_PATH) ??
    maybeValue(windowEnv?.VOICE_RUNTIME_BASE_PATH);
  if (explicitVoiceRuntimeBasePath) {
    return normalizeVoiceRuntimeBasePath(explicitVoiceRuntimeBasePath);
  }

  const frontendPublicBasePath =
    maybeValue(importMetaEnv.VITE_FRONTEND_PUBLIC_BASE_PATH) ??
    maybeValue(windowEnv?.FRONTEND_PUBLIC_BASE_PATH);
  if (frontendPublicBasePath) {
    return joinVoiceRuntimePath(
      frontendPublicBasePath,
      VOICE_RUNTIME_DIRECTORY,
    );
  }

  const frontendPlatform =
    maybeValue(importMetaEnv.VITE_FRONTEND_PLATFORM) ??
    maybeValue(windowEnv?.FRONTEND_PLATFORM);
  const fallbackFrontendPublicBasePath =
    frontendPlatform === "platform-office-addin"
      ? "/public/platform-office-addin"
      : "/public/common";

  return joinVoiceRuntimePath(
    fallbackFrontendPublicBasePath,
    VOICE_RUNTIME_DIRECTORY,
  );
}

export function resolveVoiceRuntimeAssets(
  overrides: VoiceRuntimeAssetOverrides | string = {},
): VoiceRuntimeAssets {
  const normalizedOverrides =
    typeof overrides === "string" ? { basePath: overrides } : overrides;
  const basePath = normalizeVoiceRuntimeBasePath(
    normalizedOverrides.basePath ?? getDefaultVoiceRuntimeBasePath(),
  );
  const ricky0123VadBaseAssetPath = joinVoiceRuntimeDirectory(
    basePath,
    RICKY0123_VAD_ASSET_DIRECTORY,
  );
  const onnxWASMBasePath = joinVoiceRuntimeDirectory(
    basePath,
    ONNX_RUNTIME_WEB_ASSET_DIRECTORY,
  );

  return {
    basePath,
    manifestUrl:
      normalizedOverrides.manifestUrl ??
      joinVoiceRuntimePath(basePath, VOICE_RUNTIME_MANIFEST_FILENAME),
    ricky0123Vad: {
      baseAssetPath:
        normalizedOverrides.ricky0123Vad?.baseAssetPath ??
        ricky0123VadBaseAssetPath,
      onnxWASMBasePath:
        normalizedOverrides.ricky0123Vad?.onnxWASMBasePath ?? onnxWASMBasePath,
      workletUrl:
        normalizedOverrides.ricky0123Vad?.workletUrl ??
        joinVoiceRuntimePath(
          ricky0123VadBaseAssetPath,
          "vad.worklet.bundle.min.js",
        ),
      sileroVadLegacyModelUrl:
        normalizedOverrides.ricky0123Vad?.sileroVadLegacyModelUrl ??
        joinVoiceRuntimePath(
          ricky0123VadBaseAssetPath,
          "silero_vad_legacy.onnx",
        ),
      sileroVadV5ModelUrl:
        normalizedOverrides.ricky0123Vad?.sileroVadV5ModelUrl ??
        joinVoiceRuntimePath(ricky0123VadBaseAssetPath, "silero_vad_v5.onnx"),
    },
  };
}
