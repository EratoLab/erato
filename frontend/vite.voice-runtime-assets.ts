import fs from "node:fs";
import path from "node:path";

import type { Plugin } from "vite";

import {
  ONNX_RUNTIME_WEB_ASSET_DIRECTORY,
  RICKY0123_VAD_ASSET_DIRECTORY,
  RICKY0123_VAD_DIST_FILES,
  VOICE_RUNTIME_DIRECTORY,
  VOICE_RUNTIME_MANIFEST_FILENAME,
} from "./src/lib/voice-runtime/assets";

const VOICE_RUNTIME_SOURCE_FILES = [VOICE_RUNTIME_MANIFEST_FILENAME];
const ONNX_RUNTIME_WEB_DIST_EXTENSIONS = new Set([".wasm", ".mjs"]);
const ONNX_RUNTIME_WEB_DIST_PREFIX = "ort-wasm-";

const isOnnxRuntimeWebRuntimeFile = (basename: string): boolean =>
  basename.startsWith(ONNX_RUNTIME_WEB_DIST_PREFIX) &&
  ONNX_RUNTIME_WEB_DIST_EXTENSIONS.has(path.extname(basename));

const isRicky0123VadDistFile = (
  filename: string,
): filename is (typeof RICKY0123_VAD_DIST_FILES)[number] =>
  (RICKY0123_VAD_DIST_FILES as readonly string[]).includes(filename);

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
      path.join(rootDir, "public", VOICE_RUNTIME_DIRECTORY, filename),
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
    if (!isOnnxRuntimeWebRuntimeFile(path.basename(filePath))) {
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

  const targetPath = path.resolve(outputDir, ...pathSegments);
  const resolvedOutputDir = path.resolve(outputDir);
  if (
    targetPath !== resolvedOutputDir &&
    !targetPath.startsWith(resolvedOutputDir + path.sep)
  ) {
    throw new Error(`Refusing to clean unsafe output path: ${outputBasePath}`);
  }

  fs.rmSync(targetPath, {
    recursive: true,
    force: true,
  });
};

export const resolveVoiceRuntimePackageAssetFile = (
  rootDir: string,
  requestPath: string,
  runtimeBasePath: string,
): string | null => {
  if (requestPath.includes("\0") || requestPath.includes("\\")) {
    return null;
  }

  const normalizedPath = requestPath.split("?")[0].split("#")[0];
  const normalizedRuntimeBasePath = runtimeBasePath.replace(/\/+$/, "");
  const vadPrefix = `${normalizedRuntimeBasePath}/${RICKY0123_VAD_ASSET_DIRECTORY}/`;
  const onnxPrefix = `${normalizedRuntimeBasePath}/${ONNX_RUNTIME_WEB_ASSET_DIRECTORY}/`;

  try {
    if (normalizedPath.startsWith(vadPrefix)) {
      const filename = decodeURIComponent(
        normalizedPath.slice(vadPrefix.length),
      );
      if (
        filename.includes("/") ||
        filename.includes("\\") ||
        filename.includes("\0") ||
        !isRicky0123VadDistFile(filename)
      ) {
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
        relativePath.includes("\0") ||
        relativePath.includes("\\") ||
        path.isAbsolute(relativePath) ||
        !isOnnxRuntimeWebRuntimeFile(path.basename(relativePath))
      ) {
        return null;
      }
      const distDir = path.join(packageDir(rootDir, "onnxruntime-web"), "dist");
      const resolvedDistDir = path.resolve(distDir);
      const joinedPath = path.resolve(resolvedDistDir, relativePath);
      if (
        joinedPath !== resolvedDistDir &&
        !joinedPath.startsWith(resolvedDistDir + path.sep)
      ) {
        return null;
      }
      return joinedPath;
    }
  } catch {
    return null;
  }

  return null;
};
