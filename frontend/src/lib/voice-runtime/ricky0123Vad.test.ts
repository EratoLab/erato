import { describe, expect, it } from "vitest";

import { createRicky0123VadAssetOptions } from "./ricky0123Vad";

describe("createRicky0123VadAssetOptions", () => {
  it("returns the option names expected by @ricky0123/vad-web", () => {
    expect(
      createRicky0123VadAssetOptions("/public/common/voice-runtime"),
    ).toEqual({
      baseAssetPath: "/public/common/voice-runtime/ricky0123-vad-web/",
      onnxWASMBasePath: "/public/common/voice-runtime/onnxruntime-web/",
    });
  });

  it("uses base path overrides", () => {
    expect(
      createRicky0123VadAssetOptions({
        basePath: "/voice",
      }),
    ).toEqual({
      baseAssetPath: "/voice/ricky0123-vad-web/",
      onnxWASMBasePath: "/voice/onnxruntime-web/",
    });
  });

  it("uses fully-populated overrides", () => {
    expect(
      createRicky0123VadAssetOptions({
        basePath: "/voice",
        manifestUrl: "/voice/manifest.json",
        ricky0123Vad: {
          baseAssetPath: "/voice/vad/",
          onnxWASMBasePath: "/voice/ort/",
          workletUrl: "/voice/vad/worklet.js",
          sileroVadLegacyModelUrl: "/voice/vad/legacy.onnx",
          sileroVadV5ModelUrl: "/voice/vad/v5.onnx",
        },
      }),
    ).toEqual({
      baseAssetPath: "/voice/vad/",
      onnxWASMBasePath: "/voice/ort/",
    });
  });

  it("treats partial ricky0123Vad overrides as overrides, not as resolved", () => {
    expect(
      createRicky0123VadAssetOptions({
        basePath: "/voice",
        ricky0123Vad: {
          onnxWASMBasePath: "/custom/ort/",
        },
      }),
    ).toEqual({
      baseAssetPath: "/voice/ricky0123-vad-web/",
      onnxWASMBasePath: "/custom/ort/",
    });
  });
});
