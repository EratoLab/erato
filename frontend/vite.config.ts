import fs from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";

import { lingui } from "@lingui/vite-plugin";
import react from "@vitejs/plugin-react";
import {
  createLogger,
  defineConfig,
  type Logger,
  type Plugin,
  type ViteDevServer,
} from "vite";

import {
  cleanVoiceRuntimePackageAssetOutput,
  emitVoiceRuntimePackageAssets,
  resolveVoiceRuntimePackageAssetFile,
} from "./vite.voice-runtime-assets";

// Custom plugin to copy index.html as 404.html for SPA routing
const copy404Plugin = ({ silent = false }: { silent?: boolean } = {}) => {
  return {
    name: "copy-404",
    writeBundle(options: any) {
      const outDir = options.dir || "out";
      const indexPath = path.join(outDir, "index.html");
      const notFoundPath = path.join(outDir, "404.html");

      if (fs.existsSync(indexPath)) {
        fs.copyFileSync(indexPath, notFoundPath);
        if (!silent) {
          console.log("✓ Copied index.html to 404.html");
        }
      }
    },
  };
};

const createDevLinkedBuildLogger = (enabled: boolean): Logger | undefined => {
  if (!enabled) {
    return undefined;
  }

  const logger = createLogger();
  const originalWarn = logger.warn;

  logger.warn = (msg, options) => {
    if (
      msg.includes("date-fns/locale/en-US.js is dynamically imported") ||
      msg.includes("Some chunks are larger than 500 kB after minification.")
    ) {
      return;
    }

    originalWarn(msg, options);
  };

  return logger;
};

const contentTypeForPath = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".ico":
      return "image/x-icon";
    case ".json":
      return "application/json; charset=utf-8";
    case ".onnx":
      return "application/octet-stream";
    case ".otf":
      return "font/otf";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".ttf":
      return "font/ttf";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
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
    const stats = fs.statSync(entryPath);
    if (stats.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (stats.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
};

const resolveStructuredPublicFile = (
  projectRootDir: string,
  requestPath: string,
): string | null => {
  const publicDir = path.join(projectRootDir, "public");
  const sourceLocalesDir = path.join(projectRootDir, "src", "locales");
  const normalizedPath = requestPath.split("?")[0];

  if (
    normalizedPath === "/public/favicon.ico" ||
    normalizedPath === "/favicon.ico"
  ) {
    return path.join(publicDir, "favicon.ico");
  }
  if (
    normalizedPath === "/public/favicon.svg" ||
    normalizedPath === "/favicon.svg"
  ) {
    return path.join(publicDir, "favicon.svg");
  }
  if (normalizedPath.startsWith("/public/common/locales/")) {
    const relativePath = normalizedPath.replace("/public/common/locales/", "");
    return path.join(sourceLocalesDir, relativePath);
  }
  if (normalizedPath.startsWith("/public/common/voice-runtime/")) {
    const runtimePackageAssetPath = resolveVoiceRuntimePackageAssetFile(
      projectRootDir,
      normalizedPath,
      "/public/common/voice-runtime",
    );
    if (runtimePackageAssetPath) {
      return runtimePackageAssetPath;
    }
  }
  if (normalizedPath.startsWith("/public/common/custom-theme/")) {
    const relativePath = normalizedPath.replace(
      "/public/common/custom-theme/",
      "",
    );
    return path.join(publicDir, "custom-theme", relativePath);
  }
  if (normalizedPath.startsWith("/public/common/")) {
    const relativePath = normalizedPath.replace("/public/common/", "");
    if (relativePath.startsWith("assets/")) {
      return null;
    }
    return path.join(publicDir, relativePath);
  }

  return null;
};

const sendStructuredPublicFile = (
  server: ViteDevServer,
  requestPath: string,
  response: ServerResponse,
): boolean => {
  const resolvedPath = resolveStructuredPublicFile(
    server.config.root,
    requestPath,
  );
  if (
    !resolvedPath ||
    !fs.existsSync(resolvedPath) ||
    fs.statSync(resolvedPath).isDirectory()
  ) {
    return false;
  }

  response.statusCode = 200;
  response.setHeader("Content-Type", contentTypeForPath(resolvedPath));
  response.setHeader("X-Content-Type-Options", "nosniff");
  fs.createReadStream(resolvedPath).pipe(response);
  return true;
};

const stagePublicLayoutPlugin = (): Plugin => {
  const rootDir = __dirname;
  const publicDir = path.join(rootDir, "public");
  const sourceLocalesDir = path.join(rootDir, "src", "locales");

  return {
    name: "stage-public-layout",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url) {
          next();
          return;
        }

        if (sendStructuredPublicFile(server, request.url, response)) {
          return;
        }

        next();
      });
    },
    generateBundle(outputOptions) {
      for (const filePath of walkFiles(publicDir)) {
        const relativePath = path.relative(publicDir, filePath);
        if (
          relativePath.startsWith(`common${path.sep}`) ||
          relativePath.startsWith(`public${path.sep}`) ||
          relativePath.startsWith(`voice-runtime${path.sep}`)
        ) {
          continue;
        }

        const normalizedRelativePath = relativePath.split(path.sep).join("/");
        const targetPath =
          normalizedRelativePath === "favicon.ico" ||
          normalizedRelativePath === "favicon.svg"
            ? `public/${normalizedRelativePath}`
            : normalizedRelativePath.startsWith("custom-theme/")
              ? `public/common/${normalizedRelativePath}`
              : `public/common/${normalizedRelativePath}`;

        this.emitFile({
          type: "asset",
          fileName: targetPath,
          source: fs.readFileSync(filePath),
        });
      }

      const voiceRuntimeOutputBasePath = "public/common/voice-runtime";
      cleanVoiceRuntimePackageAssetOutput(
        outputOptions.dir,
        voiceRuntimeOutputBasePath,
      );
      emitVoiceRuntimePackageAssets(this, rootDir, voiceRuntimeOutputBasePath);

      for (const filePath of walkFiles(sourceLocalesDir)) {
        if (!filePath.endsWith(`${path.sep}messages.json`)) {
          continue;
        }

        const relativePath = path
          .relative(sourceLocalesDir, filePath)
          .split(path.sep)
          .join("/");
        this.emitFile({
          type: "asset",
          fileName: `public/common/locales/${relativePath}`,
          source: fs.readFileSync(filePath),
        });
      }
    },
  };
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const silentLinkedBuildOutput = mode === "dev-linked";

  return {
    customLogger: createDevLinkedBuildLogger(silentLinkedBuildOutput),
    plugins: [
      react({
        babel: {
          plugins: ["@lingui/babel-plugin-lingui-macro"],
        },
      }),
      lingui(),
      stagePublicLayoutPlugin(),
      copy404Plugin({ silent: silentLinkedBuildOutput }),
    ],
    publicDir: false,
    server: {
      port: 3000, // You can change this if needed
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      outDir: "out",
      assetsDir: "public/common/assets",
      reportCompressedSize: !silentLinkedBuildOutput,
    },
  };
});
