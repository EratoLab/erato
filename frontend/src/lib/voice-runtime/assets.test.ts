import { describe, expect, it } from "vitest";

import {
  getDefaultVoiceRuntimeBasePath,
  joinVoiceRuntimeDirectory,
  joinVoiceRuntimePath,
  normalizeVoiceRuntimeBasePath,
  resolveVoiceRuntimeAssets,
} from "./assets";

describe("voice runtime assets", () => {
  it("normalizes base paths without changing the route prefix", () => {
    expect(normalizeVoiceRuntimeBasePath("/public/common/voice-runtime/")).toBe(
      "/public/common/voice-runtime",
    );
    expect(
      normalizeVoiceRuntimeBasePath(
        "https://example.test/public/common/voice-runtime/",
      ),
    ).toBe("https://example.test/public/common/voice-runtime");
  });

  it("joins runtime paths and directories", () => {
    expect(
      joinVoiceRuntimePath(
        "/public/common/voice-runtime/",
        "/ricky0123-vad-web/",
        "silero_vad_v5.onnx",
      ),
    ).toBe("/public/common/voice-runtime/ricky0123-vad-web/silero_vad_v5.onnx");
    expect(
      joinVoiceRuntimeDirectory(
        "/public/common/voice-runtime",
        "onnxruntime-web",
      ),
    ).toBe("/public/common/voice-runtime/onnxruntime-web/");
  });

  it("derives defaults from frontend public base globals", () => {
    const previousFrontendPublicBasePath = window.FRONTEND_PUBLIC_BASE_PATH;
    window.FRONTEND_PUBLIC_BASE_PATH = "/public/platform-office-addin";
    try {
      expect(getDefaultVoiceRuntimeBasePath()).toBe(
        "/public/platform-office-addin/voice-runtime",
      );
    } finally {
      window.FRONTEND_PUBLIC_BASE_PATH = previousFrontendPublicBasePath;
    }
  });

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

  it("supports explicit per-asset overrides", () => {
    expect(
      resolveVoiceRuntimeAssets({
        basePath: "/voice",
        ricky0123Vad: {
          onnxWASMBasePath: "/custom/ort/",
        },
      }).ricky0123Vad.onnxWASMBasePath,
    ).toBe("/custom/ort/");
  });
});
