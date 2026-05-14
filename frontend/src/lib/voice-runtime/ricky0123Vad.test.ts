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

  it("accepts already-resolved runtime assets", () => {
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
});
