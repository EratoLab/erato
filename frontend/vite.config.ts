import fs from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";

import { lingui } from "@lingui/vite-plugin";
import { i18nKeysManifestPlugin } from "@erato/frontend-utils/i18n-keys";
import react from "@vitejs/plugin-react";
import {
  createLogger,
  defineConfig,
  type Logger,
  type Plugin,
  type ViteDevServer,
} from "vite";
import { consoleForwardPlugin } from "vite-console-forward-plugin";

import {
  cleanVoiceRuntimePackageAssetOutput,
  emitVoiceRuntimePackageAssets,
  resolveVoiceRuntimePackageAssetFile,
} from "./vite.voice-runtime-assets";
import { SHARED_MODULES } from "./shared-modules.config";
import {
  contentTypeForPath,
  devComponentKitsPlugin,
  sharedModulesImportMapPlugin,
  walkFiles,
} from "./component-kit-host.plugins";

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
  // Dev-only: forward browser console.* + errors to the Vite terminal so they
  // can be read off-device (e.g. iOS simulator) and by coding agents. Gated on
  // mode so it is never added to a production `vite build` (ERMAIN-373).
  const isProductionBuild = mode === "production";

  return {
    customLogger: createDevLinkedBuildLogger(silentLinkedBuildOutput),
    plugins: [
      react({
        babel: {
          plugins: ["@lingui/babel-plugin-lingui-macro"],
        },
      }),
      lingui(),
      i18nKeysManifestPlugin(),
      stagePublicLayoutPlugin(),
      // Dev map points at the `/src/shared/*.ts` expose files — vite
      // transforms those like app modules, so kit imports resolve to the
      // same module instances as the app's own.
      sharedModulesImportMapPlugin({
        devUrl: (entry) => `/src/shared/${entry.file}`,
      }),
      devComponentKitsPlugin({ rootDir: __dirname }),
      copy404Plugin({ silent: silentLinkedBuildOutput }),
      // Endpoint lives under "/" so oauth2-proxy routes it to Vite (:3000);
      // it must NOT be under "/api/" which the proxy sends to the backend.
      ...(isProductionBuild
        ? []
        : [
            consoleForwardPlugin({
              endpoint: "/__client-logs",
            }),
          ]),
    ],
    publicDir: false,
    server: {
      port: 3000, // You can change this if needed
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["@lingui/core", "@lingui/react", "react", "react-dom"],
    },
    build: {
      outDir: "out",
      assetsDir: "public/common/assets",
      reportCompressedSize: !silentLinkedBuildOutput,
      rollupOptions: {
        // Expose entries must keep their re-export signatures so the import
        // map can hand kits the app-bundle module instances.
        preserveEntrySignatures: "allow-extension" as const,
        input: {
          app: path.resolve(__dirname, "index.html"),
          componentKitReactRuntime: path.resolve(
            __dirname,
            "src/componentKitReactRuntime.ts",
          ),
          ...Object.fromEntries(
            SHARED_MODULES.map((entry) => [
              entry.entryName,
              path.resolve(__dirname, "src/shared", entry.file),
            ]),
          ),
        },
        output: {
          // The app imports generated exports from this runtime, so both files
          // must be cache-busted together to avoid cross-deployment mismatches.
          entryFileNames: (chunkInfo) =>
            chunkInfo.name === "componentKitReactRuntime"
              ? "public/common/assets/component-kit-react-runtime-[hash].js"
              : "public/common/assets/[name]-[hash].js",
        },
      },
    },
  };
});
