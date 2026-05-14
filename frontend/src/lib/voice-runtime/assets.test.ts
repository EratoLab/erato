import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getDefaultVoiceRuntimeBasePath,
  joinVoiceRuntimePath,
  normalizeVoiceRuntimeBasePath,
  resolveVoiceRuntimeAssets,
} from "./assets";

describe("normalizeVoiceRuntimeBasePath", () => {
  it("strips trailing slashes from absolute paths", () => {
    expect(normalizeVoiceRuntimeBasePath("/public/common/voice-runtime/")).toBe(
      "/public/common/voice-runtime",
    );
  });

  it("strips trailing slashes from absolute URLs", () => {
    expect(
      normalizeVoiceRuntimeBasePath(
        "https://example.test/public/common/voice-runtime/",
      ),
    ).toBe("https://example.test/public/common/voice-runtime");
  });

  it("collapses pure-slash and empty values to empty string", () => {
    expect(normalizeVoiceRuntimeBasePath("/")).toBe("");
    expect(normalizeVoiceRuntimeBasePath("")).toBe("");
    expect(normalizeVoiceRuntimeBasePath("   ")).toBe("");
  });

  it("collapses repeated trailing slashes", () => {
    expect(normalizeVoiceRuntimeBasePath("/voice-runtime///")).toBe(
      "/voice-runtime",
    );
  });
});

describe("joinVoiceRuntimePath", () => {
  it("joins segments and trims internal slashes", () => {
    expect(
      joinVoiceRuntimePath(
        "/public/common/voice-runtime/",
        "/ricky0123-vad-web/",
        "silero_vad_v5.onnx",
      ),
    ).toBe("/public/common/voice-runtime/ricky0123-vad-web/silero_vad_v5.onnx");
  });

  it("returns base or '/' when no segments are supplied", () => {
    expect(joinVoiceRuntimePath("/voice-runtime")).toBe("/voice-runtime");
    expect(joinVoiceRuntimePath("")).toBe("/");
  });
});

describe("getDefaultVoiceRuntimeBasePath", () => {
  const originalWindow = {
    VOICE_RUNTIME_BASE_PATH: window.VOICE_RUNTIME_BASE_PATH,
    FRONTEND_PUBLIC_BASE_PATH: window.FRONTEND_PUBLIC_BASE_PATH,
    FRONTEND_PLATFORM: window.FRONTEND_PLATFORM,
  };

  afterEach(() => {
    window.VOICE_RUNTIME_BASE_PATH = originalWindow.VOICE_RUNTIME_BASE_PATH;
    window.FRONTEND_PUBLIC_BASE_PATH = originalWindow.FRONTEND_PUBLIC_BASE_PATH;
    window.FRONTEND_PLATFORM = originalWindow.FRONTEND_PLATFORM;
    vi.unstubAllEnvs();
  });

  it("prefers VITE_VOICE_RUNTIME_BASE_PATH over every other source", () => {
    vi.stubEnv("VITE_VOICE_RUNTIME_BASE_PATH", "/from-vite-env");
    window.VOICE_RUNTIME_BASE_PATH = "/from-window";
    window.FRONTEND_PUBLIC_BASE_PATH = "/from-window-public";
    expect(getDefaultVoiceRuntimeBasePath()).toBe("/from-vite-env");
  });

  it("falls back to window.VOICE_RUNTIME_BASE_PATH next", () => {
    window.VOICE_RUNTIME_BASE_PATH = "/from-window";
    window.FRONTEND_PUBLIC_BASE_PATH = "/from-window-public";
    expect(getDefaultVoiceRuntimeBasePath()).toBe("/from-window");
  });

  it("falls back to VITE_FRONTEND_PUBLIC_BASE_PATH + voice-runtime", () => {
    vi.stubEnv("VITE_FRONTEND_PUBLIC_BASE_PATH", "/from-vite-public");
    expect(getDefaultVoiceRuntimeBasePath()).toBe(
      "/from-vite-public/voice-runtime",
    );
  });

  it("falls back to window.FRONTEND_PUBLIC_BASE_PATH + voice-runtime", () => {
    window.FRONTEND_PUBLIC_BASE_PATH = "/public/platform-office-addin";
    expect(getDefaultVoiceRuntimeBasePath()).toBe(
      "/public/platform-office-addin/voice-runtime",
    );
  });

  it("uses the platform-office-addin fallback when no base globals are set", () => {
    window.FRONTEND_PLATFORM = "platform-office-addin";
    expect(getDefaultVoiceRuntimeBasePath()).toBe(
      "/public/platform-office-addin/voice-runtime",
    );
  });

  it("falls back to /public/common/voice-runtime by default", () => {
    expect(getDefaultVoiceRuntimeBasePath()).toBe(
      "/public/common/voice-runtime",
    );
  });

  it("ignores whitespace-only env values", () => {
    vi.stubEnv("VITE_VOICE_RUNTIME_BASE_PATH", "   ");
    expect(getDefaultVoiceRuntimeBasePath()).toBe(
      "/public/common/voice-runtime",
    );
  });
});

describe("resolveVoiceRuntimeAssets", () => {
  it("resolves the package-specific runtime URLs from a base path", () => {
    expect(resolveVoiceRuntimeAssets("/public/common/voice-runtime")).toEqual({
      basePath: "/public/common/voice-runtime",
      manifestUrl: "/public/common/voice-runtime/manifest.json",
      ricky0123Vad: {
        baseAssetPath: "/public/common/voice-runtime/ricky0123-vad-web/",
        onnxWASMBasePath: "/public/common/voice-runtime/onnxruntime-web/",
        workletUrl:
          "/public/common/voice-runtime/ricky0123-vad-web/vad.worklet.bundle.min.js",
        sileroVadLegacyModelUrl:
          "/public/common/voice-runtime/ricky0123-vad-web/silero_vad_legacy.onnx",
        sileroVadV5ModelUrl:
          "/public/common/voice-runtime/ricky0123-vad-web/silero_vad_v5.onnx",
      },
    });
  });

  it("supports per-asset overrides", () => {
    const overridden = resolveVoiceRuntimeAssets({
      basePath: "/voice",
      manifestUrl: "/custom/manifest.json",
      ricky0123Vad: {
        baseAssetPath: "/custom/vad/",
        onnxWASMBasePath: "/custom/ort/",
        workletUrl: "/custom/worklet.js",
        sileroVadLegacyModelUrl: "/custom/legacy.onnx",
        sileroVadV5ModelUrl: "/custom/v5.onnx",
      },
    });

    expect(overridden.manifestUrl).toBe("/custom/manifest.json");
    expect(overridden.ricky0123Vad.workletUrl).toBe("/custom/worklet.js");
    expect(overridden.ricky0123Vad.onnxWASMBasePath).toBe("/custom/ort/");
  });

  it("falls back to derived URLs when only some override fields are set", () => {
    const partial = resolveVoiceRuntimeAssets({
      basePath: "/voice",
      ricky0123Vad: {
        onnxWASMBasePath: "/custom/ort/",
      },
    });

    expect(partial.ricky0123Vad.onnxWASMBasePath).toBe("/custom/ort/");
    expect(partial.ricky0123Vad.baseAssetPath).toBe(
      "/voice/ricky0123-vad-web/",
    );
    expect(partial.ricky0123Vad.workletUrl).toBe(
      "/voice/ricky0123-vad-web/vad.worklet.bundle.min.js",
    );
  });

  it("accepts a string base path", () => {
    expect(resolveVoiceRuntimeAssets("/voice").manifestUrl).toBe(
      "/voice/manifest.json",
    );
  });
});
