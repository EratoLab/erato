/**
 * Host-side vite plugins for the component-kit import-map contract, shared by
 * every host that serves kits (web frontend, office add-in).
 *
 * Build: hosts emit `import-map.manifest.json` (specifier -> hashed chunk URL)
 * so the backend can inject `<script type="importmap">` into served HTML.
 * Dev: hosts inject the map and the kit script/stylesheet tags themselves;
 * each host supplies the dev URL scheme that preserves module identity with
 * its own bundle (web: `/src/shared/*.ts` sources, add-in linked mode: the
 * built library via `/@fs/`).
 *
 * Like `@erato/frontend-utils/i18n-keys`, plugin shapes are typed
 * structurally instead of importing vite types: each host resolves its own
 * vite instance, and nominal types from this package's copy would not be
 * assignable to the other host's `defineConfig`.
 */
import fs from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";

import {
  IMPORT_MAP_MANIFEST_FILE_NAME,
  SHARED_MODULES,
  type SharedModuleEntry,
} from "./shared-modules.config";

type HostLogger = {
  warn(message: string): void;
};

const consoleLogger: HostLogger = {
  warn: (message) => console.warn(message),
};

type DevServerLike = {
  config: { logger: HostLogger };
  middlewares: {
    use(
      handler: (
        request: { url?: string },
        response: ServerResponse,
        next: () => void,
      ) => void,
    ): void;
  };
};

type HtmlTagDescriptor = {
  tag: string;
  attrs?: Record<string, string>;
  children?: string;
  injectTo?: "head" | "body" | "head-prepend" | "body-prepend";
};

type BundleOutput = {
  type: string;
  fileName: string;
  name?: string;
  isEntry?: boolean;
};

type EmitFileContext = {
  emitFile(file: { type: "asset"; fileName: string; source: string }): void;
};

/**
 * Shared-module import map for component kits.
 *
 * `devUrl` maps each shared-module entry to the URL the dev import map should
 * point at; omit it for hosts (or modes) that do not serve kits in dev. The
 * build-time manifest is always emitted.
 */
export const sharedModulesImportMapPlugin = (
  options: { devUrl?: (entry: SharedModuleEntry) => string } = {},
) => {
  return {
    name: "shared-modules-import-map",
    transformIndexHtml: {
      order: "pre" as const,
      handler(
        _html: string,
        ctx: { server?: unknown },
      ): HtmlTagDescriptor[] | undefined {
        // Dev server only — production HTML gets the map from the backend.
        const { devUrl } = options;
        if (ctx.server === undefined || devUrl === undefined) {
          return;
        }
        const imports = Object.fromEntries(
          SHARED_MODULES.map((entry) => [entry.specifier, devUrl(entry)]),
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
    generateBundle(
      this: EmitFileContext,
      _options: unknown,
      bundle: Record<string, BundleOutput>,
    ): void {
      const imports: Record<string, string> = {};
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk" || !output.isEntry) {
          continue;
        }
        const entry = SHARED_MODULES.find((e) => e.entryName === output.name);
        if (entry) {
          // Bundle-relative; the backend prefixes the serving mount path.
          imports[entry.specifier] = output.fileName;
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

/**
 * Dev import-map URLs for a host whose shared modules come from a built
 * `dist-library` (e.g. the add-in in linked mode). Specifiers resolve through
 * the library's own import-map manifest — the same source of truth the
 * backend uses — and are served via vite's `/@fs/` escape hatch, so the kit
 * and the host's aliased imports hit identical module URLs.
 */
export const distLibraryDevUrls = (
  distLibraryDir: string,
  base = "/",
): ((entry: SharedModuleEntry) => string) => {
  const hostDir = path.join(distLibraryDir, "component-kit-host");
  const manifestPath = path.join(hostDir, IMPORT_MAP_MANIFEST_FILE_NAME);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Erato component-kit host manifest does not exist: ${manifestPath}. Build @erato/frontend first.`,
    );
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    imports?: Record<string, string>;
  };
  const imports = manifest.imports ?? {};
  const basePrefix = base.endsWith("/") ? base : `${base}/`;

  return (entry) => {
    const target = imports[entry.specifier];
    if (!target) {
      throw new Error(
        `Shared module ${entry.specifier} is missing from ${manifestPath}`,
      );
    }
    const fsPath = path.resolve(hostDir, target).split(path.sep).join("/");
    return `${basePrefix}@fs${fsPath}`;
  };
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

export const contentTypeForPath = (filePath: string): string => {
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

export const walkFiles = (directory: string): string[] => {
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
  return (logger: HostLogger | undefined, message: string): void => {
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
  logger?: HostLogger,
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
  rootDir: string,
  server: DevServerLike,
  requestPath: string,
  response: ServerResponse,
): boolean => {
  const componentKits = discoverDevComponentKits(rootDir, server.config.logger);
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

/**
 * Serves local component kits in dev and injects their script/stylesheet
 * tags. `rootDir` is the directory containing the `component-kits` file;
 * relative entries in that file resolve against it, so hosts sharing one
 * file see identical kits.
 */
export const devComponentKitsPlugin = (options: { rootDir: string }) => {
  const { rootDir } = options;
  let logger: HostLogger | undefined;

  return {
    name: "dev-component-kits",
    apply: "serve" as const,
    configureServer(server: DevServerLike) {
      logger = server.config.logger;
      server.middlewares.use((request, response, next) => {
        if (!request.url) {
          next();
          return;
        }

        if (sendDevComponentKitFile(rootDir, server, request.url, response)) {
          return;
        }

        next();
      });
    },
    transformIndexHtml(html: string): string {
      return injectDevComponentKitTags(
        html,
        discoverDevComponentKits(rootDir, logger ?? consoleLogger),
      );
    },
  };
};
