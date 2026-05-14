import fs from "node:fs";
import path from "node:path";

import type { Plugin } from "vite";

const RICKY0123_VAD_ASSET_DIRECTORY = "ricky0123-vad-web";
const ONNX_RUNTIME_WEB_ASSET_DIRECTORY = "onnxruntime-web";
const RICKY0123_VAD_DIST_FILES = [
  "vad.worklet.bundle.min.js",
  "silero_vad_legacy.onnx",
  "silero_vad_v5.onnx",
];
const VOICE_RUNTIME_SOURCE_FILES = ["manifest.json"];
const ONNX_RUNTIME_WEB_DIST_EXTENSIONS = new Set([".wasm"]);

type AssetEmitter = {
  emitFile(file: { type: "asset"; fileName: string; source: Buffer }): string;
  error(message: string): never;
};

const walkFiles = (directory: string): string[] => {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
};

const packageDir = (rootDir: string, packageName: string): string => {
  const packageJsonPath = path.join(
    rootDir,
    "node_modules",
    ...packageName.split("/"),
    "package.json",
  );
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Could not find ${packageName} in ${rootDir}/node_modules`);
  }

  return path.dirname(packageJsonPath);
};

const emitAssetFile = (
  emitter: AssetEmitter,
  sourcePath: string,
  outputPath: string,
) => {
  if (!fs.existsSync(sourcePath)) {
    emitter.error(`Missing voice runtime asset: ${sourcePath}`);
  }

  emitter.emitFile({
    type: "asset",
    fileName: outputPath,
    source: fs.readFileSync(sourcePath),
  });
};

export const emitVoiceRuntimePackageAssets = (
  emitter: AssetEmitter,
  rootDir: string,
  outputBasePath: string,
) => {
  for (const filename of VOICE_RUNTIME_SOURCE_FILES) {
    emitAssetFile(
      emitter,
      path.join(rootDir, "public", "voice-runtime", filename),
      `${outputBasePath}/${filename}`,
    );
  }

  let vadDistDir: string;
  let onnxRuntimeDistDir: string;
  try {
    vadDistDir = path.join(packageDir(rootDir, "@ricky0123/vad-web"), "dist");
    onnxRuntimeDistDir = path.join(
      packageDir(rootDir, "onnxruntime-web"),
      "dist",
    );
  } catch (error) {
    emitter.error(error instanceof Error ? error.message : String(error));
  }

  for (const filename of RICKY0123_VAD_DIST_FILES) {
    emitAssetFile(
      emitter,
      path.join(vadDistDir, filename),
      `${outputBasePath}/${RICKY0123_VAD_ASSET_DIRECTORY}/${filename}`,
    );
  }

  for (const filePath of walkFiles(onnxRuntimeDistDir)) {
    if (!ONNX_RUNTIME_WEB_DIST_EXTENSIONS.has(path.extname(filePath))) {
      continue;
    }

    const relativePath = path
      .relative(onnxRuntimeDistDir, filePath)
      .split(path.sep)
      .join("/");
    emitAssetFile(
      emitter,
      filePath,
      `${outputBasePath}/${ONNX_RUNTIME_WEB_ASSET_DIRECTORY}/${relativePath}`,
    );
  }
};

export const createVoiceRuntimePackageAssetsPlugin = ({
  rootDir,
  outputBasePath,
}: {
  rootDir: string;
  outputBasePath: string;
}): Plugin => ({
  name: "stage-voice-runtime-package-assets",
  generateBundle(options) {
    cleanVoiceRuntimePackageAssetOutput(options.dir, outputBasePath);
    emitVoiceRuntimePackageAssets(this, rootDir, outputBasePath);
  },
});

export const cleanVoiceRuntimePackageAssetOutput = (
  outputDir: string | undefined,
  outputBasePath: string,
) => {
  if (!outputDir) {
    return;
  }

  const relativeOutputBasePath = outputBasePath.replace(/^\/+|\/+$/g, "");
  const pathSegments = relativeOutputBasePath.split(/[\\/]/).filter(Boolean);
  if (
    pathSegments.length === 0 ||
    pathSegments.some((segment) => segment === "..")
  ) {
    throw new Error(`Refusing to clean unsafe output path: ${outputBasePath}`);
  }

  fs.rmSync(path.join(outputDir, ...pathSegments), {
    recursive: true,
    force: true,
  });
};

export const resolveVoiceRuntimePackageAssetFile = (
  rootDir: string,
  requestPath: string,
  runtimeBasePath: string,
): string | null => {
  const normalizedPath = requestPath.split("?")[0];
  const normalizedRuntimeBasePath = runtimeBasePath.replace(/\/+$/, "");
  const vadPrefix = `${normalizedRuntimeBasePath}/${RICKY0123_VAD_ASSET_DIRECTORY}/`;
  const onnxPrefix = `${normalizedRuntimeBasePath}/${ONNX_RUNTIME_WEB_ASSET_DIRECTORY}/`;

  try {
    if (normalizedPath.startsWith(vadPrefix)) {
      const filename = decodeURIComponent(
        normalizedPath.slice(vadPrefix.length),
      );
      if (!RICKY0123_VAD_DIST_FILES.includes(filename)) {
        return null;
      }
      return path.join(
        packageDir(rootDir, "@ricky0123/vad-web"),
        "dist",
        filename,
      );
    }

    if (normalizedPath.startsWith(onnxPrefix)) {
      const relativePath = decodeURIComponent(
        normalizedPath.slice(onnxPrefix.length),
      );
      if (
        relativePath.includes("..") ||
        !ONNX_RUNTIME_WEB_DIST_EXTENSIONS.has(path.extname(relativePath))
      ) {
        return null;
      }
      return path.join(
        packageDir(rootDir, "onnxruntime-web"),
        "dist",
        relativePath,
      );
    }
  } catch {
    return null;
  }

  return null;
};
