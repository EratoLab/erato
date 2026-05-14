import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanVoiceRuntimePackageAssetOutput,
  emitVoiceRuntimePackageAssets,
  resolveVoiceRuntimePackageAssetFile,
} from "./vite.voice-runtime-assets";

const createdRoots: string[] = [];

const writeRootFile = (
  rootDir: string,
  relativePath: string,
  content = "asset",
) => {
  const filePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
};

const writePackageFile = (
  rootDir: string,
  packageName: string,
  relativePath: string,
  content = "asset",
) => {
  const filePath = path.join(
    rootDir,
    "node_modules",
    ...packageName.split("/"),
    relativePath,
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
};

const createPackageRoot = () => {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "voice-runtime-assets-"),
  );
  createdRoots.push(rootDir);

  writeRootFile(
    rootDir,
    "public/voice-runtime/manifest.json",
    JSON.stringify({ version: 1, engines: {} }),
  );

  writePackageFile(
    rootDir,
    "@ricky0123/vad-web",
    "package.json",
    JSON.stringify({ name: "@ricky0123/vad-web" }),
  );
  writePackageFile(
    rootDir,
    "@ricky0123/vad-web",
    "dist/vad.worklet.bundle.min.js",
  );
  writePackageFile(
    rootDir,
    "@ricky0123/vad-web",
    "dist/silero_vad_legacy.onnx",
  );
  writePackageFile(rootDir, "@ricky0123/vad-web", "dist/silero_vad_v5.onnx");

  writePackageFile(
    rootDir,
    "onnxruntime-web",
    "package.json",
    JSON.stringify({ name: "onnxruntime-web" }),
  );
  writePackageFile(rootDir, "onnxruntime-web", "dist/ort.min.js");
  writePackageFile(rootDir, "onnxruntime-web", "dist/ort.wasm.min.mjs");
  writePackageFile(
    rootDir,
    "onnxruntime-web",
    "dist/ort-wasm-simd-threaded.wasm",
  );
  writePackageFile(
    rootDir,
    "onnxruntime-web",
    "dist/ort-wasm-simd-threaded.jsep.wasm",
  );

  return rootDir;
};

afterEach(() => {
  for (const rootDir of createdRoots.splice(0)) {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

describe("voice runtime package asset staging", () => {
  it("emits VAD package assets and ONNX Runtime WASM files", () => {
    const rootDir = createPackageRoot();
    const emitted: string[] = [];

    emitVoiceRuntimePackageAssets(
      {
        emitFile(file) {
          emitted.push(file.fileName);
          return file.fileName;
        },
        error(message) {
          throw new Error(message);
        },
      },
      rootDir,
      "voice-runtime",
    );

    expect(emitted.sort()).toEqual(
      [
        "voice-runtime/onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm",
        "voice-runtime/onnxruntime-web/ort-wasm-simd-threaded.wasm",
        "voice-runtime/manifest.json",
        "voice-runtime/ricky0123-vad-web/silero_vad_legacy.onnx",
        "voice-runtime/ricky0123-vad-web/silero_vad_v5.onnx",
        "voice-runtime/ricky0123-vad-web/vad.worklet.bundle.min.js",
      ].sort(),
    );
  });

  it("resolves only staged package asset paths for dev serving", () => {
    const rootDir = createPackageRoot();
    const runtimeBasePath = "/public/common/voice-runtime";

    expect(
      resolveVoiceRuntimePackageAssetFile(
        rootDir,
        `${runtimeBasePath}/ricky0123-vad-web/vad.worklet.bundle.min.js`,
        runtimeBasePath,
      ),
    ).toBe(
      path.join(
        rootDir,
        "node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js",
      ),
    );
    expect(
      resolveVoiceRuntimePackageAssetFile(
        rootDir,
        `${runtimeBasePath}/onnxruntime-web/ort-wasm-simd-threaded.wasm`,
        runtimeBasePath,
      ),
    ).toBe(
      path.join(
        rootDir,
        "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
      ),
    );
    expect(
      resolveVoiceRuntimePackageAssetFile(
        rootDir,
        `${runtimeBasePath}/onnxruntime-web/ort.min.js`,
        runtimeBasePath,
      ),
    ).toBeNull();
    expect(
      resolveVoiceRuntimePackageAssetFile(
        rootDir,
        `${runtimeBasePath}/onnxruntime-web/../secret.wasm`,
        runtimeBasePath,
      ),
    ).toBeNull();
  });

  it("cleans the managed output directory before re-emitting assets", () => {
    const rootDir = createPackageRoot();
    const managedOutputDir = path.join(
      rootDir,
      "dist-library",
      "voice-runtime",
    );
    const staleFilePath = path.join(
      managedOutputDir,
      "onnxruntime-web",
      "ort.min.js",
    );
    fs.mkdirSync(path.dirname(staleFilePath), { recursive: true });
    fs.writeFileSync(staleFilePath, "stale");

    cleanVoiceRuntimePackageAssetOutput(
      path.join(rootDir, "dist-library"),
      "voice-runtime",
    );

    expect(fs.existsSync(managedOutputDir)).toBe(false);
  });
});
