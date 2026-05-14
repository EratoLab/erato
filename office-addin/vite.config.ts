import fs from "node:fs";
import path from "node:path";

import { lingui } from "@lingui/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";

import type { ServerResponse } from "node:http";

const loadOfficeAddinEnv = (mode: string) => {
  const developmentEnv =
    mode === "development" ? {} : loadEnv("development", __dirname, "");
  const modeEnv = loadEnv(mode, __dirname, "");

  return {
    ...developmentEnv,
    ...modeEnv,
  };
};

const copy404Plugin = () => {
  return {
    name: "copy-404",
    writeBundle(options: { dir?: string }) {
      const outDir = options.dir ?? "dist";
      const indexPath = path.join(outDir, "index.html");
      const notFoundPath = path.join(outDir, "404.html");

      if (fs.existsSync(indexPath)) {
        fs.copyFileSync(indexPath, notFoundPath);
        console.log("✓ Copied index.html to 404.html");
      }
    },
  };
};

const contentTypeForPath = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".onnx":
      return "application/octet-stream";
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
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
};

const resolveFrontendVoiceRuntimeDir = (): string | null => {
  const candidates = [
    path.resolve(__dirname, "../frontend/dist-library/voice-runtime"),
    path.resolve(
      __dirname,
      "node_modules",
      "@erato",
      "frontend",
      "dist-library",
      "voice-runtime",
    ),
  ];

  return (
    candidates.find(
      (candidate) =>
        fs.existsSync(candidate) && fs.statSync(candidate).isDirectory(),
    ) ?? null
  );
};

const sendVoiceRuntimeFile = (
  sourceDir: string,
  requestPath: string,
  response: ServerResponse,
): boolean => {
  if (requestPath.includes("\0") || requestPath.includes("\\")) {
    return false;
  }

  const normalizedPath = requestPath.split("?")[0].split("#")[0];
  const requestPrefixes = [
    "/public/platform-office-addin/voice-runtime/",
    "/office-addin/voice-runtime/",
  ];
  const matchedPrefix = requestPrefixes.find((prefix) =>
    normalizedPath.startsWith(prefix),
  );
  if (!matchedPrefix) {
    return false;
  }

  let relativePath: string;
  try {
    relativePath = decodeURIComponent(
      normalizedPath.slice(matchedPrefix.length),
    );
  } catch {
    return false;
  }
  if (
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    path.isAbsolute(relativePath)
  ) {
    return false;
  }
  const resolvedPath = path.resolve(sourceDir, relativePath);
  const resolvedSourceDir = path.resolve(sourceDir);
  if (
    resolvedPath !== resolvedSourceDir &&
    !resolvedPath.startsWith(`${resolvedSourceDir}${path.sep}`)
  ) {
    return false;
  }
  if (!fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
    return false;
  }

  response.statusCode = 200;
  response.setHeader("Content-Type", contentTypeForPath(resolvedPath));
  response.setHeader("X-Content-Type-Options", "nosniff");
  fs.createReadStream(resolvedPath).pipe(response);
  return true;
};

const stageFrontendVoiceRuntimeAssetsPlugin = (): Plugin => {
  return {
    name: "stage-frontend-voice-runtime-assets",
    configureServer(server: ViteDevServer) {
      if (!resolveFrontendVoiceRuntimeDir()) {
        server.config.logger.warn(
          "[stage-frontend-voice-runtime-assets] @erato/frontend voice-runtime assets not found. " +
            "Run `pnpm --filter @erato/frontend build:lib` before starting the office-addin dev server, " +
            "otherwise VAD asset requests will 404 with no further warning.",
        );
      }

      server.middlewares.use((request, response, next) => {
        if (!request.url) {
          next();
          return;
        }

        const sourceDir = resolveFrontendVoiceRuntimeDir();
        if (
          sourceDir &&
          sendVoiceRuntimeFile(sourceDir, request.url, response)
        ) {
          return;
        }

        next();
      });
    },
    generateBundle() {
      const sourceDir = resolveFrontendVoiceRuntimeDir();
      if (!sourceDir) {
        this.warn(
          "Could not find @erato/frontend voice-runtime assets; skipping Office add-in voice-runtime staging.",
        );
        return;
      }

      for (const filePath of walkFiles(sourceDir)) {
        const relativePath = path
          .relative(sourceDir, filePath)
          .split(path.sep)
          .join("/");
        this.emitFile({
          type: "asset",
          fileName: `voice-runtime/${relativePath}`,
          source: fs.readFileSync(filePath),
        });
      }
    },
  };
};

const stagePlatformLocalesPlugin = () => {
  const rootDir = __dirname;
  const sourceRoot = path.join(rootDir, "src", "locales");
  const targetRoot = path.join(rootDir, "public", "locales");
  const supportedLocales = ["en", "de", "fr", "pl", "es"];

  const stage = () => {
    for (const locale of supportedLocales) {
      const targetDir = path.join(targetRoot, locale);
      fs.mkdirSync(targetDir, { recursive: true });

      const sourcePath = path.join(sourceRoot, locale, "messages.json");
      const targetPath = path.join(targetDir, "messages.json");
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, targetPath);
      } else if (!fs.existsSync(targetPath)) {
        fs.writeFileSync(targetPath, JSON.stringify({ messages: {} }, null, 2));
      }
    }
  };

  return {
    name: "stage-platform-locales",
    buildStart() {
      stage();
    },
    configureServer() {
      stage();
    },
  };
};

const watchLinkedFrontendPublicOutputPlugin = (enabled: boolean) => {
  if (!enabled) {
    return {
      name: "watch-linked-frontend-public-output",
    };
  }

  const frontendPublicOutputDir = path.resolve(
    __dirname,
    "../frontend/out/public",
  );
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleReload = (server: ViteDevServer, changedFile: string) => {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
    }

    reloadTimer = setTimeout(() => {
      console.log(
        `[linked-frontend-public-output] Detected rebuilt asset: ${path.relative(
          __dirname,
          changedFile,
        )}; reloading add-in clients`,
      );
      server.ws.send({ type: "full-reload" });
    }, 150);
  };

  return {
    name: "watch-linked-frontend-public-output",
    configureServer(server: ViteDevServer) {
      const onOutputChange = (filePath: string) => {
        const resolvedFilePath = path.resolve(filePath);
        if (
          resolvedFilePath !== frontendPublicOutputDir &&
          !resolvedFilePath.startsWith(`${frontendPublicOutputDir}${path.sep}`)
        ) {
          return;
        }

        scheduleReload(server, resolvedFilePath);
      };

      server.watcher.add(frontendPublicOutputDir);
      server.watcher.on("add", onOutputChange);
      server.watcher.on("change", onOutputChange);
      server.watcher.on("unlink", onOutputChange);
    },
  };
};

export default defineConfig(({ mode }) => {
  const env = loadOfficeAddinEnv(mode);
  const apiRootUrl = env.VITE_API_ROOT_URL;
  const linkedFrontend = mode === "linked";
  const isDevServer = mode !== "production";
  const define = Object.fromEntries(
    Object.entries(env)
      .filter(([key]) => key.startsWith("VITE_"))
      .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
  );

  const apiProxy =
    apiRootUrl && !apiRootUrl.startsWith("http://localhost:3002")
      ? {
          "/office-addin/manifest.xml": {
            target: new URL(apiRootUrl).origin,
            changeOrigin: true,
            secure: false,
          },
          "/api/": {
            target: new URL(apiRootUrl).origin,
            changeOrigin: true,
            secure: false,
          },
        }
      : undefined;

  return {
    base: isDevServer ? "/office-addin/" : "/public/platform-office-addin/",
    clearScreen: false,
    define,
    plugins: [
      react({
        babel: {
          plugins: ["@lingui/babel-plugin-lingui-macro"],
        },
      }),
      lingui(),
      stagePlatformLocalesPlugin(),
      stageFrontendVoiceRuntimeAssetsPlugin(),
      watchLinkedFrontendPublicOutputPlugin(linkedFrontend),
      copy404Plugin(),
    ],
    resolve: linkedFrontend
      ? {
          alias: {
            "@erato/frontend/library": path.resolve(
              __dirname,
              "../frontend/dist-library/library.js",
            ),
            "@erato/frontend/library.css": path.resolve(
              __dirname,
              "../frontend/dist-library/style.css",
            ),
          },
        }
      : undefined,
    server: {
      host: true,
      allowedHosts: [".ts.net"],
      port: 3002,
      strictPort: true,
      proxy: apiProxy,
      fs: {
        allow: [path.resolve(__dirname, "..")],
      },
    },
  };
});
