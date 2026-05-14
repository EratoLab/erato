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
  writePackageFile(rootDir, "onnxruntime-web", "dist/ort.min.mjs");
  writePackageFile(rootDir, "onnxruntime-web", "dist/ort.wasm.min.mjs");
  writePackageFile(rootDir, "onnxruntime-web", "dist/ort.webgpu.mjs");
  writePackageFile(
    rootDir,
    "onnxruntime-web",
    "dist/ort-wasm-simd-threaded.wasm",
  );
  writePackageFile(
    rootDir,
    "onnxruntime-web",
    "dist/ort-wasm-simd-threaded.mjs",
  );
  writePackageFile(
    rootDir,
    "onnxruntime-web",
    "dist/ort-wasm-simd-threaded.jsep.wasm",
  );
  writePackageFile(
    rootDir,
    "onnxruntime-web",
    "dist/ort-wasm-simd-threaded.jsep.mjs",
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
        "voice-runtime/onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs",
        "voice-runtime/onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm",
        "voice-runtime/onnxruntime-web/ort-wasm-simd-threaded.mjs",
        "voice-runtime/onnxruntime-web/ort-wasm-simd-threaded.wasm",
        "voice-runtime/manifest.json",
        "voice-runtime/ricky0123-vad-web/silero_vad_legacy.onnx",
        "voice-runtime/ricky0123-vad-web/silero_vad_v5.onnx",
        "voice-runtime/ricky0123-vad-web/vad.worklet.bundle.min.js",
      ].sort(),
    );
  });

  it("does not emit ONNX top-level loader bundles", () => {
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

    expect(emitted).not.toContain("voice-runtime/onnxruntime-web/ort.min.mjs");
    expect(emitted).not.toContain(
      "voice-runtime/onnxruntime-web/ort.wasm.min.mjs",
    );
    expect(emitted).not.toContain(
      "voice-runtime/onnxruntime-web/ort.webgpu.mjs",
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

  it("returns null for an unknown asset prefix", () => {
    const rootDir = createPackageRoot();
    expect(
      resolveVoiceRuntimePackageAssetFile(
        rootDir,
        "/public/common/voice-runtime/other-engine/foo.onnx",
        "/public/common/voice-runtime",
      ),
    ).toBeNull();
  });

  it("strips query strings and fragments before matching", () => {
    const rootDir = createPackageRoot();
    const runtimeBasePath = "/public/common/voice-runtime";

    expect(
      resolveVoiceRuntimePackageAssetFile(
        rootDir,
        `${runtimeBasePath}/onnxruntime-web/ort-wasm-simd-threaded.wasm?v=1`,
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
        `${runtimeBasePath}/onnxruntime-web/ort-wasm-simd-threaded.wasm#fragment`,
        runtimeBasePath,
      ),
    ).toBe(
      path.join(
        rootDir,
        "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
      ),
    );
  });

  it("rejects ONNX traversal via encoded parent-directory segments", () => {
    const rootDir = createPackageRoot();
    const runtimeBasePath = "/public/common/voice-runtime";

    for (const variant of [
      `${runtimeBasePath}/onnxruntime-web/%2E%2E/%2E%2E/etc/passwd.wasm`,
      `${runtimeBasePath}/onnxruntime-web/../secret.wasm`,
      `${runtimeBasePath}/onnxruntime-web/sub/../../escape.wasm`,
    ]) {
      expect(
        resolveVoiceRuntimePackageAssetFile(rootDir, variant, runtimeBasePath),
      ).toBeNull();
    }
  });

  it("rejects ONNX absolute paths after decoding", () => {
    const rootDir = createPackageRoot();
    const runtimeBasePath = "/public/common/voice-runtime";

    expect(
      resolveVoiceRuntimePackageAssetFile(
        rootDir,
        `${runtimeBasePath}/onnxruntime-web/%2Fetc%2Fpasswd.wasm`,
        runtimeBasePath,
      ),
    ).toBeNull();
  });

  it("rejects request paths containing null bytes or backslashes", () => {
    const rootDir = createPackageRoot();
    const runtimeBasePath = "/public/common/voice-runtime";

    expect(
      resolveVoiceRuntimePackageAssetFile(
        rootDir,
        `${runtimeBasePath}/ricky0123-vad-web/vad.worklet.bundle.min.js%00.txt`,
        runtimeBasePath,
      ),
    ).toBeNull();
    expect(
      resolveVoiceRuntimePackageAssetFile(
        rootDir,
        `${runtimeBasePath}/onnxruntime-web/..\\secret.wasm`,
        runtimeBasePath,
      ),
    ).toBeNull();
  });

  it("rejects VAD filenames that contain path separators after decoding", () => {
    const rootDir = createPackageRoot();
    const runtimeBasePath = "/public/common/voice-runtime";

    expect(
      resolveVoiceRuntimePackageAssetFile(
        rootDir,
        `${runtimeBasePath}/ricky0123-vad-web/subdir%2Fvad.worklet.bundle.min.js`,
        runtimeBasePath,
      ),
    ).toBeNull();
  });

  it("rejects ONNX files with non-WASM/non-MJS extensions", () => {
    const rootDir = createPackageRoot();
    const runtimeBasePath = "/public/common/voice-runtime";

    expect(
      resolveVoiceRuntimePackageAssetFile(
        rootDir,
        `${runtimeBasePath}/onnxruntime-web/ort.min.js`,
        runtimeBasePath,
      ),
    ).toBeNull();
  });

  it("resolves ONNX runtime .mjs glue files", () => {
    const rootDir = createPackageRoot();
    const runtimeBasePath = "/public/common/voice-runtime";

    for (const filename of [
      "ort-wasm-simd-threaded.mjs",
      "ort-wasm-simd-threaded.jsep.mjs",
    ]) {
      expect(
        resolveVoiceRuntimePackageAssetFile(
          rootDir,
          `${runtimeBasePath}/onnxruntime-web/${filename}`,
          runtimeBasePath,
        ),
      ).toBe(path.join(rootDir, `node_modules/onnxruntime-web/dist/${filename}`));
    }
  });

  it("rejects ONNX top-level loader bundles even when extension matches", () => {
    const rootDir = createPackageRoot();
    const runtimeBasePath = "/public/common/voice-runtime";

    for (const filename of [
      "ort.min.mjs",
      "ort.wasm.min.mjs",
      "ort.webgpu.mjs",
    ]) {
      expect(
        resolveVoiceRuntimePackageAssetFile(
          rootDir,
          `${runtimeBasePath}/onnxruntime-web/${filename}`,
          runtimeBasePath,
        ),
      ).toBeNull();
    }
  });

  it("errors when manifest source is missing", () => {
    const rootDir = createPackageRoot();
    fs.rmSync(path.join(rootDir, "public", "voice-runtime", "manifest.json"));

    expect(() =>
      emitVoiceRuntimePackageAssets(
        {
          emitFile() {
            return "";
          },
          error(message) {
            throw new Error(message);
          },
        },
        rootDir,
        "voice-runtime",
      ),
    ).toThrow(/Missing voice runtime asset/);
  });

  it("errors when @ricky0123/vad-web is not installed", () => {
    const rootDir = createPackageRoot();
    fs.rmSync(path.join(rootDir, "node_modules", "@ricky0123"), {
      recursive: true,
    });

    expect(() =>
      emitVoiceRuntimePackageAssets(
        {
          emitFile() {
            return "";
          },
          error(message) {
            throw new Error(message);
          },
        },
        rootDir,
        "voice-runtime",
      ),
    ).toThrow(/@ricky0123\/vad-web/);
  });

  it("no-ops when no outputDir is provided", () => {
    expect(() =>
      cleanVoiceRuntimePackageAssetOutput(undefined, "voice-runtime"),
    ).not.toThrow();
  });

  it("refuses to clean empty or pure-slash output paths", () => {
    const rootDir = createPackageRoot();
    for (const unsafe of ["", "/", "///"]) {
      expect(() =>
        cleanVoiceRuntimePackageAssetOutput(rootDir, unsafe),
      ).toThrow(/Refusing to clean unsafe output path/);
    }
  });

  it("refuses to clean paths containing parent-directory segments", () => {
    const rootDir = createPackageRoot();
    for (const unsafe of ["..", "voice-runtime/..", "../escape"]) {
      expect(() =>
        cleanVoiceRuntimePackageAssetOutput(rootDir, unsafe),
      ).toThrow(/Refusing to clean unsafe output path/);
    }
  });
});
