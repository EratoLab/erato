import fs from "node:fs";
import path from "node:path";

import { i18nKeysManifestPlugin } from "@erato/frontend-utils/i18n-keys";
import { lingui } from "@lingui/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";

import {
  devComponentKitsPlugin,
  distLibraryDevUrls,
  sharedModulesImportMapPlugin,
} from "../frontend/component-kit-host.plugins";
import {
  isLibraryBuildInFlight,
  LIBRARY_BUILD_KEYS,
  libraryBuildStatusFingerprint,
  libraryBuildStatusPath,
  readLibraryBuildStatuses,
} from "../frontend/library-build-status";
import {
  SHARED_MODULES,
  type SharedModuleEntry,
} from "../frontend/shared-modules.config";

import type { ServerResponse } from "node:http";

// Expose entries are consumed from the packed frontend library instead of
// local facade copies: the erato barrel via `./shared`, third-party facades
// via `./shared-runtime/*` (compiled from frontend/src/shared with the
// packages external, so this build bundles the add-in's own instances).
const sharedModuleInputId = (entry: SharedModuleEntry): string =>
  entry.specifier === "@erato/frontend/shared"
    ? entry.specifier
    : `@erato/frontend/shared-runtime/${entry.file.replace(/\.ts$/, "")}`;

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
    case ".ico":
      return "image/x-icon";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
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

const sendPublicAssetAliasFile = (
  publicDir: string,
  requestPath: string,
  response: ServerResponse,
): boolean => {
  if (requestPath.includes("\0") || requestPath.includes("\\")) {
    return false;
  }

  const normalizedPath = requestPath.split("?")[0].split("#")[0];
  let relativePath: string;
  if (normalizedPath === "/favicon.ico") {
    relativePath = "favicon.ico";
  } else if (normalizedPath.startsWith("/assets/")) {
    try {
      relativePath = decodeURIComponent(normalizedPath.slice(1));
    } catch {
      return false;
    }
  } else {
    return false;
  }

  if (
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    path.isAbsolute(relativePath)
  ) {
    return false;
  }

  const resolvedPath = path.resolve(publicDir, relativePath);
  const resolvedPublicDir = path.resolve(publicDir);
  if (
    resolvedPath !== resolvedPublicDir &&
    !resolvedPath.startsWith(`${resolvedPublicDir}${path.sep}`)
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

const serveRootPublicAssetAliasesPlugin = (): Plugin => {
  return {
    name: "serve-root-public-asset-aliases",
    configureServer(server: ViteDevServer) {
      const publicDir = path.resolve(__dirname, "public");
      server.middlewares.use((request, response, next) => {
        if (
          request.url &&
          sendPublicAssetAliasFile(publicDir, request.url, response)
        ) {
          return;
        }

        next();
      });
    },
  };
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

const resolveFrontendLibraryAssetsDir = (): string | null => {
  const candidates = [
    path.resolve(__dirname, "../frontend/dist-library/assets"),
    path.resolve(
      __dirname,
      "node_modules",
      "@erato",
      "frontend",
      "dist-library",
      "assets",
    ),
  ];

  return (
    candidates.find(
      (candidate) =>
        fs.existsSync(candidate) && fs.statSync(candidate).isDirectory(),
    ) ?? null
  );
};

const sendFrontendLibraryAssetFile = (
  sourceDir: string,
  requestPath: string,
  response: ServerResponse,
): boolean => {
  if (requestPath.includes("\0") || requestPath.includes("\\")) {
    return false;
  }

  const normalizedPath = requestPath.split("?")[0].split("#")[0];
  const requestPrefix = "/assets/";
  if (!normalizedPath.startsWith(requestPrefix)) {
    return false;
  }

  let relativePath: string;
  try {
    relativePath = decodeURIComponent(
      normalizedPath.slice(requestPrefix.length),
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

/**
 * The @erato/frontend library bakes the audio worklet URL as "/assets/…"
 * (its Vite build uses the default base "/"). In the office add-in production
 * build, assets are served under "/public/platform-office-addin/", so the
 * worklet lands at "/public/platform-office-addin/assets/…". The baked
 * "/assets/…" URL therefore 404s at runtime.
 *
 * In dev mode the stageFrontendLibraryAssetsPlugin middleware intercepts
 * "/assets/…" requests and serves the files correctly, so no rewrite is
 * needed there.
 */
const rewriteLibraryWorkerUrlsPlugin = (isDevServer: boolean): Plugin => {
  if (isDevServer) {
    return { name: "rewrite-library-worker-urls" };
  }

  const PRODUCTION_BASE = "/public/platform-office-addin";

  return {
    name: "rewrite-library-worker-urls",
    renderChunk(code) {
      if (!code.includes("/assets/audio-dictation-worklet-")) {
        return null;
      }
      const updated = code.replace(
        /(['"])(\/assets\/audio-dictation-worklet-[^'"]+\.js)\1/g,
        (_, quote, assetPath) =>
          `${quote}${PRODUCTION_BASE}${assetPath}${quote}`,
      );
      return updated !== code ? updated : null;
    },
  };
};

const stageFrontendLibraryAssetsPlugin = (): Plugin => {
  return {
    name: "stage-frontend-library-assets",
    configureServer(server: ViteDevServer) {
      if (!resolveFrontendLibraryAssetsDir()) {
        server.config.logger.warn(
          "[stage-frontend-library-assets] @erato/frontend library assets not found. " +
            "Run `pnpm --filter @erato/frontend build:lib` before starting the office-addin dev server, " +
            "otherwise audio worklet requests may 404.",
        );
      }

      server.middlewares.use((request, response, next) => {
        if (!request.url) {
          next();
          return;
        }

        const sourceDir = resolveFrontendLibraryAssetsDir();
        if (
          sourceDir &&
          sendFrontendLibraryAssetFile(sourceDir, request.url, response)
        ) {
          return;
        }

        next();
      });
    },
    generateBundle() {
      const sourceDir = resolveFrontendLibraryAssetsDir();
      if (!sourceDir) {
        this.warn(
          "Could not find @erato/frontend library assets; skipping Office add-in library asset staging.",
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
          fileName: `assets/${relativePath}`,
          source: fs.readFileSync(filePath),
        });
      }
    },
  };
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

      for (const filename of ["messages.json", "messages.po"]) {
        const sourcePath = path.join(sourceRoot, locale, filename);
        const targetPath = path.join(targetDir, filename);
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, targetPath);
        } else if (filename === "messages.json" && !fs.existsSync(targetPath)) {
          fs.writeFileSync(
            targetPath,
            JSON.stringify({ messages: {} }, null, 2),
          );
        }
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

const LINKED_LIBRARY_RELOAD_DEBOUNCE_MS = 200;
const LINKED_LIBRARY_REQUEST_POLL_MS = 50;
const LINKED_LIBRARY_REQUEST_MAX_WAIT_MS = 30_000;
const LINKED_LIBRARY_HOLD_LOG_INTERVAL_MS = 2_000;

/**
 * Keeps linked mode consistent with the library build that produces the files
 * it aliases.
 *
 * `vite build --watch` rewrites `dist-library` in place over ~20 s. Reacting to
 * those file events reloads the page mid-write, and `library.mjs` carries its
 * entire named-export block in its last few percent: a truncated read is still
 * valid JS with zero exports, so the module link fails and nothing recovers it
 * — worst in the Teams tab, which is an iframe with no reload affordance and no
 * React boundary that could catch a link-time error.
 *
 * So file events under `dist-library` are swallowed, and the build's own
 * completion status drives both halves instead: reloads wait for it, and reads
 * of those files are held while a build is in flight (which also covers a
 * manual refresh, and `component-kit-host`'s `emptyOutDir` window). Without a
 * status file — an older frontend build — everything falls back to the
 * unguarded behaviour rather than going quiet.
 */
const linkedFrontendLibraryPlugin = (enabled: boolean): Plugin => {
  if (!enabled) {
    return { name: "linked-frontend-library" };
  }

  const distLibraryDir = path.resolve(__dirname, "../frontend/dist-library");
  const statusPaths = LIBRARY_BUILD_KEYS.map((key) =>
    libraryBuildStatusPath(distLibraryDir, key),
  );

  const isDistLibraryFile = (filePath: string): boolean => {
    const resolved = path.resolve(filePath);
    return (
      resolved === distLibraryDir ||
      resolved.startsWith(`${distLibraryDir}${path.sep}`)
    );
  };

  const hasBuildStatus = (): boolean => statusPaths.some(fs.existsSync);

  const requestTargetsDistLibrary = (url: string): boolean => {
    const pathname = url.split("?")[0].split("#")[0];
    const fsIndex = pathname.indexOf("/@fs/");
    if (fsIndex === -1) {
      return false;
    }

    try {
      return isDistLibraryFile(
        decodeURIComponent(pathname.slice(fsIndex + "/@fs".length)),
      );
    } catch {
      return false;
    }
  };

  const buildInFlight = (): boolean =>
    isLibraryBuildInFlight(
      readLibraryBuildStatuses(distLibraryDir),
      Date.now(),
    );

  let lastFingerprint = "";
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  let lastHoldLogAt = 0;

  return {
    name: "linked-frontend-library",
    handleHotUpdate(ctx) {
      if (hasBuildStatus() && isDistLibraryFile(ctx.file)) {
        return [];
      }
    },
    configureServer(server: ViteDevServer) {
      lastFingerprint = libraryBuildStatusFingerprint(
        readLibraryBuildStatuses(distLibraryDir),
      );

      if (!hasBuildStatus()) {
        server.config.logger.warn(
          "[linked-frontend-library] no build status in ../frontend/dist-library; " +
            "library rebuilds fall back to unguarded reloads. Run `pnpm --dir ../frontend build:lib`.",
        );
      }

      const invalidateDistLibraryModules = (): number => {
        let invalidated = 0;
        for (const [file, modules] of server.moduleGraph.fileToModulesMap) {
          if (!isDistLibraryFile(file)) {
            continue;
          }

          for (const module of modules) {
            server.moduleGraph.invalidateModule(module);
            invalidated += 1;
          }
        }

        return invalidated;
      };

      const scheduleReload = (): void => {
        if (reloadTimer) {
          clearTimeout(reloadTimer);
        }

        reloadTimer = setTimeout(() => {
          reloadTimer = undefined;
          if (buildInFlight()) {
            scheduleReload();
            return;
          }

          const statuses = readLibraryBuildStatuses(distLibraryDir);
          const fingerprint = libraryBuildStatusFingerprint(statuses);
          if (fingerprint === lastFingerprint) {
            return;
          }
          lastFingerprint = fingerprint;

          const failed = Object.entries(statuses).filter(
            ([, status]) => status.state === "failed",
          );
          if (failed.length > 0) {
            server.config.logger.warn(
              `[linked-frontend-library] ${failed
                .map(([key]) => key)
                .join(", ")} build failed; keeping the current bundle loaded`,
            );
            return;
          }

          console.log(
            `[linked-frontend-library] library rebuild complete (${invalidateDistLibraryModules()} modules invalidated); reloading add-in clients`,
          );
          server.ws.send({ type: "full-reload" });
        }, LINKED_LIBRARY_RELOAD_DEBOUNCE_MS);
      };

      const onStatusChange = (filePath: string) => {
        if (statusPaths.includes(path.resolve(filePath))) {
          scheduleReload();
        }
      };

      server.watcher.add(statusPaths);
      server.watcher.on("add", onStatusChange);
      server.watcher.on("change", onStatusChange);

      server.middlewares.use((request, _response, next) => {
        if (
          !request.url ||
          !requestTargetsDistLibrary(request.url) ||
          !buildInFlight()
        ) {
          next();
          return;
        }

        const now = Date.now();
        if (now - lastHoldLogAt > LINKED_LIBRARY_HOLD_LOG_INTERVAL_MS) {
          lastHoldLogAt = now;
          console.log(
            "[linked-frontend-library] library build in progress; holding dist-library requests until it completes",
          );
        }

        const deadline = now + LINKED_LIBRARY_REQUEST_MAX_WAIT_MS;
        const poll = () => {
          if (!buildInFlight()) {
            next();
            return;
          }

          if (Date.now() >= deadline) {
            server.config.logger.warn(
              "[linked-frontend-library] library build still running; serving dist-library as-is",
            );
            next();
            return;
          }

          setTimeout(poll, LINKED_LIBRARY_REQUEST_POLL_MS);
        };

        setTimeout(poll, LINKED_LIBRARY_REQUEST_POLL_MS);
      });
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
          "/office-addin/manifest-exchange-server.xml": {
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
      i18nKeysManifestPlugin(),
      serveRootPublicAssetAliasesPlugin(),
      stageFrontendLibraryAssetsPlugin(),
      stagePlatformLocalesPlugin(),
      stageFrontendVoiceRuntimeAssetsPlugin(),
      rewriteLibraryWorkerUrlsPlugin(isDevServer),
      watchLinkedFrontendPublicOutputPlugin(linkedFrontend),
      linkedFrontendLibraryPlugin(linkedFrontend && isDevServer),
      // Build: emits the manifest the backend injects (add-in mount path).
      // Linked dev: injects the map itself, resolving specifiers through the
      // built library's manifest so kit and app share module instances. The
      // aliases and the map point at the same files; non-linked dev resolves
      // @erato/frontend from node_modules pre-bundled, where no stable kit
      // URL scheme exists, so kits stay a linked-mode (and backend-served)
      // concern.
      sharedModulesImportMapPlugin({
        devUrl:
          linkedFrontend && isDevServer
            ? distLibraryDevUrls(
                path.resolve(__dirname, "../frontend/dist-library"),
                "/office-addin/",
              )
            : undefined,
      }),
      ...(linkedFrontend && isDevServer
        ? [
            devComponentKitsPlugin({
              rootDir: path.resolve(__dirname, "../frontend"),
            }),
          ]
        : []),
      copy404Plugin(),
    ],
    resolve: linkedFrontend
      ? {
          alias: {
            "@erato/frontend/library": path.resolve(
              __dirname,
              "../frontend/dist-library/library.mjs",
            ),
            "@erato/frontend/library.css": path.resolve(
              __dirname,
              "../frontend/dist-library/style.css",
            ),
            "@erato/frontend/shared": path.resolve(
              __dirname,
              "../frontend/dist-library/shared.mjs",
            ),
            ...Object.fromEntries(
              SHARED_MODULES.filter(
                (entry) => entry.specifier !== "@erato/frontend/shared",
              ).map((entry) => [
                sharedModuleInputId(entry),
                path.resolve(
                  __dirname,
                  "../frontend/dist-library/component-kit-host",
                  `${entry.entryName}.mjs`,
                ),
              ]),
            ),
          },
        }
      : undefined,
    build: {
      rollupOptions: {
        // Shared expose entries: chunks are shared with the app entry, so
        // the import map hands kits the add-in's own module instances.
        preserveEntrySignatures: "allow-extension" as const,
        input: {
          main: path.resolve(__dirname, "index.html"),
          ...Object.fromEntries(
            SHARED_MODULES.map((entry) => [
              entry.entryName,
              sharedModuleInputId(entry),
            ]),
          ),
        },
      },
    },
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
