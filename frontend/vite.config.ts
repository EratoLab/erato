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
import {
  IMPORT_MAP_MANIFEST_FILE_NAME,
  SHARED_MODULES,
} from "./shared-modules.config";

/**
 * Shared-module import map for component kits.
 *
 * Build: emits `import-map.manifest.json` (specifier -> hashed chunk URL) so
 * the backend can inject `<script type="importmap">` into served HTML.
 * Dev: injects the map directly, pointing every specifier at its
 * `/src/shared/*.ts` expose file — vite transforms those like app modules,
 * so kit imports resolve to the same module instances as the app's own.
 */
const sharedModulesImportMapPlugin = (): Plugin => {
  return {
    name: "shared-modules-import-map",
    transformIndexHtml: {
      order: "pre",
      handler(_html, ctx) {
        // Dev server only — production HTML gets the map from the backend.
        if (ctx.server === undefined) {
          return;
        }
        const imports = Object.fromEntries(
          SHARED_MODULES.map((entry) => [
            entry.specifier,
            `/src/shared/${entry.file}`,
          ]),
        );
        return [
          {
            tag: "script",
            attrs: { type: "importmap" },
            children: JSON.stringify({ imports }),
            injectTo: "head-prepend",
          },
        ];
      },
    },
    generateBundle(_options, bundle) {
      const imports: Record<string, string> = {};
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk" || !output.isEntry) {
          continue;
        }
        const entry = SHARED_MODULES.find((e) => e.entryName === output.name);
        if (entry) {
          imports[entry.specifier] = `/${output.fileName}`;
        }
      }
      if (Object.keys(imports).length === 0) {
        return;
      }
      this.emitFile({
        type: "asset",
        fileName: IMPORT_MAP_MANIFEST_FILE_NAME,
        source: JSON.stringify({ imports }, null, 2),
      });
    },
  };
};

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

const DEV_COMPONENT_KITS_FILE_NAME = "component-kits";
const DEV_COMPONENT_KITS_PUBLIC_MOUNT_BASE = "/public/component-kits";

type DevComponentKitAsset = {
  name: string;
  directoryPath: string;
  mountPath: string;
  scriptPath?: string;
  stylesheetPath?: string;
};

type DevComponentKitLine = {
  name?: string;
  directoryEntry: string;
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

const isValidComponentKitName = (name: string): boolean =>
  name.length > 0 &&
  name !== "." &&
  name !== ".." &&
  /^[A-Za-z0-9._-]+$/.test(name);

const isValidComponentKitAssetName = (name: string): boolean =>
  name.length > 0 && !name.startsWith(".") && /^[A-Za-z0-9._-]+$/.test(name);

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

const readRootFileNames = (directoryPath: string): string[] =>
  fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(isValidComponentKitAssetName)
    .sort();

const warnOnce = (() => {
  const messages = new Set<string>();
  return (logger: Logger | undefined, message: string): void => {
    if (messages.has(message)) {
      return;
    }
    messages.add(message);
    logger?.warn(message);
  };
})();

const parseDevComponentKitLine = (line: string): DevComponentKitLine | null => {
  const commentIndex = line.indexOf("#");
  const trimmedLine = (
    commentIndex === -1 ? line : line.slice(0, commentIndex)
  ).trim();
  if (!trimmedLine) {
    return null;
  }

  const idSeparatorMatch = trimmedLine.match(/^([A-Za-z0-9._-]+)\s+-\s+(.+)$/);
  if (!idSeparatorMatch) {
    return { directoryEntry: trimmedLine };
  }

  return {
    name: idSeparatorMatch[1],
    directoryEntry: idSeparatorMatch[2].trim(),
  };
};

const discoverDevComponentKits = (
  rootDir: string,
  logger?: Logger,
): DevComponentKitAsset[] => {
  const componentKitsFilePath = path.join(
    rootDir,
    DEV_COMPONENT_KITS_FILE_NAME,
  );
  if (!fs.existsSync(componentKitsFilePath)) {
    return [];
  }

  return fs
    .readFileSync(componentKitsFilePath, "utf8")
    .split(/\r?\n/)
    .map(parseDevComponentKitLine)
    .flatMap((componentKitLine, index) => {
      if (!componentKitLine) {
        return [];
      }

      const { directoryEntry } = componentKitLine;
      const directoryPath = path.isAbsolute(directoryEntry)
        ? path.normalize(directoryEntry)
        : path.resolve(rootDir, directoryEntry);
      if (
        !fs.existsSync(directoryPath) ||
        !fs.statSync(directoryPath).isDirectory()
      ) {
        warnOnce(
          logger,
          `[component-kits] Skipping line ${index + 1}: ${directoryPath} is not a directory`,
        );
        return [];
      }

      const name = componentKitLine.name ?? path.basename(directoryPath);
      if (!isValidComponentKitName(name)) {
        warnOnce(
          logger,
          `[component-kits] Skipping line ${index + 1}: ${name} is not a URL-safe component kit directory name`,
        );
        return [];
      }

      let fileNames: string[];
      try {
        fileNames = readRootFileNames(directoryPath);
      } catch (error) {
        warnOnce(
          logger,
          `[component-kits] Skipping line ${index + 1}: failed to read ${directoryPath}: ${String(error)}`,
        );
        return [];
      }

      const entrypoints = fileNames.filter(
        (fileName) => fileName.startsWith("index-") && fileName.endsWith(".js"),
      );
      if (entrypoints.length === 0) {
        warnOnce(
          logger,
          `[component-kits] ${directoryPath} has no root index-*.js entrypoint`,
        );
      }
      if (entrypoints.length > 1) {
        warnOnce(
          logger,
          `[component-kits] ${directoryPath} has multiple root index-*.js entrypoints; using ${entrypoints[0]}`,
        );
      }

      const stylesheets = fileNames.filter((fileName) =>
        fileName.endsWith(".css"),
      );
      if (stylesheets.length > 1) {
        warnOnce(
          logger,
          `[component-kits] ${directoryPath} has multiple root .css files; using ${stylesheets[0]}`,
        );
      }

      const mountPath = `${DEV_COMPONENT_KITS_PUBLIC_MOUNT_BASE}/${name}`;
      return [
        {
          name,
          directoryPath,
          mountPath,
          scriptPath: entrypoints[0] && `${mountPath}/${entrypoints[0]}`,
          stylesheetPath: stylesheets[0] && `${mountPath}/${stylesheets[0]}`,
        },
      ];
    });
};

const resolveDevComponentKitFile = (
  componentKits: DevComponentKitAsset[],
  requestPath: string,
): string | null => {
  let normalizedPath: string;
  try {
    normalizedPath = decodeURIComponent(requestPath.split("?")[0] ?? "");
  } catch {
    return null;
  }

  for (const componentKit of componentKits) {
    const mountPrefix = `${componentKit.mountPath}/`;
    if (!normalizedPath.startsWith(mountPrefix)) {
      continue;
    }

    const relativePath = normalizedPath.slice(mountPrefix.length);
    const resolvedPath = path.resolve(componentKit.directoryPath, relativePath);
    const pathWithinKit = path.relative(
      componentKit.directoryPath,
      resolvedPath,
    );
    if (pathWithinKit.startsWith("..") || path.isAbsolute(pathWithinKit)) {
      return null;
    }
    return resolvedPath;
  }

  return null;
};

const sendDevComponentKitFile = (
  server: ViteDevServer,
  requestPath: string,
  response: ServerResponse,
): boolean => {
  const componentKits = discoverDevComponentKits(
    server.config.root,
    server.config.logger,
  );
  const resolvedPath = resolveDevComponentKitFile(componentKits, requestPath);
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

const injectDevComponentKitTags = (
  html: string,
  componentKits: DevComponentKitAsset[],
): string => {
  const stylesheetTags = componentKits
    .flatMap((componentKit) =>
      componentKit.stylesheetPath
        ? [`<link rel="stylesheet" href="${componentKit.stylesheetPath}">`]
        : [],
    )
    .join("");
  const scriptTags = componentKits
    .flatMap((componentKit) =>
      componentKit.scriptPath
        ? [`<script type="module" src="${componentKit.scriptPath}"></script>`]
        : [],
    )
    .join("");

  let transformedHtml = stylesheetTags
    ? html.replace("</head>", `${stylesheetTags}</head>`)
    : html;
  if (!scriptTags) {
    return transformedHtml;
  }

  const reactRuntimeScriptMatch = transformedHtml.match(
    /<script\b[^>]*data-erato-component-kit-react-runtime[^>]*><\/script>/i,
  );
  if (reactRuntimeScriptMatch?.index !== undefined) {
    const insertIndex =
      reactRuntimeScriptMatch.index + reactRuntimeScriptMatch[0].length;
    return `${transformedHtml.slice(0, insertIndex)}${scriptTags}${transformedHtml.slice(insertIndex)}`;
  }

  return transformedHtml.replace(
    /<script\b[^>]*type=["']module["'][^>]*src=["'][^"']+["'][^>]*><\/script>/i,
    `${scriptTags}$&`,
  );
};

const devComponentKitsPlugin = (): Plugin => {
  const rootDir = __dirname;
  let logger: Logger | undefined;

  return {
    name: "dev-component-kits",
    apply: "serve",
    configureServer(server) {
      logger = server.config.logger;
      server.middlewares.use((request, response, next) => {
        if (!request.url) {
          next();
          return;
        }

        if (sendDevComponentKitFile(server, request.url, response)) {
          return;
        }

        next();
      });
    },
    transformIndexHtml(html) {
      return injectDevComponentKitTags(
        html,
        discoverDevComponentKits(rootDir, logger ?? createLogger()),
      );
    },
  };
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
      sharedModulesImportMapPlugin(),
      devComponentKitsPlugin(),
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
