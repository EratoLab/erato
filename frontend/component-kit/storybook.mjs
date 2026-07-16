import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { lingui } from "@lingui/vite-plugin";
import react from "@vitejs/plugin-react";

const BUILT_ENTRY_MODULE_ID = "virtual:component-kit-built-entry";
const BUILT_STYLE_MODULE_ID = "virtual:component-kit-built-style";
const RESOLVED_BUILT_ENTRY_MODULE_ID = `\0${BUILT_ENTRY_MODULE_ID}`;
const RESOLVED_BUILT_STYLE_MODULE_ID = `\0${BUILT_STYLE_MODULE_ID}`;
const HOST_PUBLIC_PATH = "erato-component-kit-host";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const hostDirectory = path.join(
  packageRoot,
  "dist-library",
  "component-kit-host",
);
const libraryDirectory = path.dirname(hostDirectory);
const hostManifestPath = path.join(hostDirectory, "import-map.manifest.json");

const normalizePath = (filePath) => filePath.split(path.sep).join("/");

const readHostEntries = () => {
  if (!fs.existsSync(hostManifestPath)) {
    throw new Error(
      `Erato component-kit host manifest does not exist: ${hostManifestPath}. Build @erato/frontend first.`,
    );
  }

  const manifest = JSON.parse(fs.readFileSync(hostManifestPath, "utf8"));
  if (!manifest.imports || typeof manifest.imports !== "object") {
    throw new Error(
      `Invalid Erato component-kit host manifest: ${hostManifestPath}`,
    );
  }

  return Object.entries(manifest.imports).map(([specifier, relativePath]) => {
    if (typeof relativePath !== "string") {
      throw new Error(
        `Invalid target for ${specifier} in Erato component-kit host manifest`,
      );
    }

    const filePath = path.resolve(hostDirectory, relativePath);
    const relativeToLibrary = path.relative(libraryDirectory, filePath);
    if (
      relativeToLibrary.startsWith("..") ||
      path.isAbsolute(relativeToLibrary) ||
      !fs.existsSync(filePath)
    ) {
      throw new Error(
        `Erato component-kit host target does not exist: ${filePath}`,
      );
    }

    return { specifier, filePath };
  });
};

const walkFiles = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(entryPath) : [entryPath];
  });

const findSingleFile = (directory, pattern, label) => {
  const matches = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${label} in ${directory}, found: ${matches.join(", ") || "none"}`,
    );
  }

  return matches[0];
};

const contentTypeFor = (filePath) => {
  switch (path.extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
};

const publicModuleUrl = (publicPath, fileName) =>
  `./${path.posix.join(publicPath, fileName)}`;

// Linear-time slash trim; an equivalent /^\/+|\/+$/ regex backtracks
// polynomially on adversarial input (flagged by CodeQL js/polynomial-redos).
const trimSlashes = (value) => {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "/") {
    start += 1;
  }
  while (end > start && value[end - 1] === "/") {
    end -= 1;
  }
  return value.slice(start, end);
};

const developmentModuleUrl = (viteRoot, filePath) => {
  const relativePath = path.relative(viteRoot, filePath);
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
    ? `/${normalizePath(relativePath)}`
    : `/@fs${normalizePath(filePath)}`;
};

/**
 * Applies the frontend's source transforms when a component kit and the
 * frontend shared surface are loaded directly by Storybook. Keeping this in
 * the frontend package prevents live Storybook configurations from drifting
 * from the frontend's Lingui macro setup.
 */
export const eratoComponentKitLiveStorybook = () => [
  react({
    babel: {
      plugins: ["@lingui/babel-plugin-lingui-macro"],
    },
  }),
  ...lingui(),
];

export const eratoComponentKitStorybook = ({
  componentKitDirectory,
  publicPath = "erato-component-kit",
}) => {
  const kitDirectory = path.resolve(componentKitDirectory);
  const normalizedPublicPath = trimSlashes(publicPath);
  const hostEntries = readHostEntries();
  const hostEntryBySpecifier = new Map(
    hostEntries.map((entry) => [entry.specifier, entry]),
  );
  const optimizeDependencies = [
    ...hostEntries
      .map((entry) => entry.specifier)
      .filter((specifier) => specifier !== "@erato/frontend/shared"),
    "react-dom/client",
  ];
  const kitEntryFileName = findSingleFile(
    kitDirectory,
    /^index-.*\.js$/,
    "component-kit entry",
  );
  const kitStyleFileName = findSingleFile(
    kitDirectory,
    /^style\.css$/,
    "component-kit stylesheet",
  );

  let command = "serve";
  let viteRoot = process.cwd();
  const hostEntryReferences = new Map();

  return {
    name: "erato-component-kit-storybook",
    enforce: "pre",
    config() {
      return {
        // The built frontend barrel and host facades are loaded as prebuilt
        // files in dev. Tell Vite about their bare imports before the initial
        // dependency crawl; otherwise its first transform can point at raw
        // CommonJS React files and remain cached after optimization finishes.
        optimizeDeps: {
          include: optimizeDependencies,
        },
        resolve: {
          dedupe: [
            "@lingui/core",
            "@lingui/react",
            "@tanstack/react-query",
            "react",
            "react-dom",
            "react-router",
            "react-router-dom",
          ],
        },
      };
    },
    configResolved(config) {
      command = config.command;
      viteRoot = config.root;
    },
    resolveId(id) {
      if (id === BUILT_ENTRY_MODULE_ID) {
        return RESOLVED_BUILT_ENTRY_MODULE_ID;
      }
      if (id === BUILT_STYLE_MODULE_ID) {
        return RESOLVED_BUILT_STYLE_MODULE_ID;
      }

      // Only alias the Erato barrel for Storybook-authored host imports.
      // Third-party facade entries must resolve their own imports normally;
      // redirecting `react` while compiling shared-react would create a
      // self-reference. The browser import map still maps the built kit's
      // untouched third-party imports to these host facade entries.
      return id === "@erato/frontend/shared"
        ? hostEntryBySpecifier.get(id)?.filePath
        : null;
    },
    load(id) {
      if (id === RESOLVED_BUILT_ENTRY_MODULE_ID) {
        const moduleUrl = publicModuleUrl(
          normalizedPublicPath,
          kitEntryFileName,
        );
        return `
const moduleUrl = new URL(${JSON.stringify(moduleUrl)}, document.baseURI).href;
const componentKitLoaded = import(/* @vite-ignore */ moduleUrl);
export default componentKitLoaded;
`;
      }

      if (id === RESOLVED_BUILT_STYLE_MODULE_ID) {
        const stylesheetUrl = publicModuleUrl(
          normalizedPublicPath,
          kitStyleFileName,
        );
        return `
const stylesheetUrl = new URL(${JSON.stringify(stylesheetUrl)}, document.baseURI).href;
let stylesheet = document.querySelector("link[data-erato-component-kit-storybook-built]");
if (!stylesheet) {
  stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.dataset.eratoComponentKitStorybookBuilt = "true";
  stylesheet.href = stylesheetUrl;
  document.head.append(stylesheet);
}
`;
      }

      return null;
    },
    transformIndexHtml: {
      order: "pre",
      handler() {
        const imports = Object.fromEntries(
          hostEntries.map((entry, index) => [
            entry.specifier,
            command === "serve"
              ? developmentModuleUrl(viteRoot, entry.filePath)
              : publicModuleUrl(HOST_PUBLIC_PATH, `${index}.js`),
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
    configureServer(server) {
      const mountPrefix = `/${normalizedPublicPath}/`;
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith(mountPrefix)) {
          next();
          return;
        }

        const requestPath = request.url.slice(mountPrefix.length).split("?")[0];
        let decodedPath;
        try {
          decodedPath = decodeURIComponent(requestPath);
        } catch {
          next();
          return;
        }

        const filePath = path.resolve(kitDirectory, decodedPath);
        const relativePath = path.relative(kitDirectory, filePath);
        if (
          relativePath.startsWith("..") ||
          path.isAbsolute(relativePath) ||
          !fs.existsSync(filePath) ||
          !fs.statSync(filePath).isFile()
        ) {
          next();
          return;
        }

        response.statusCode = 200;
        response.setHeader("Content-Type", contentTypeFor(filePath));
        response.setHeader("X-Content-Type-Options", "nosniff");
        fs.createReadStream(filePath).pipe(response);
      });
    },
    buildStart() {
      if (command !== "build") {
        return;
      }

      hostEntries.forEach((entry, index) => {
        const referenceId = this.emitFile({
          type: "chunk",
          id: entry.filePath,
          name: `erato-component-kit-host-${index}`,
          preserveSignature: "strict",
        });
        hostEntryReferences.set(entry.specifier, referenceId);
      });

      for (const filePath of walkFiles(kitDirectory)) {
        const relativePath = normalizePath(
          path.relative(kitDirectory, filePath),
        );
        this.emitFile({
          type: "asset",
          fileName: path.posix.join(normalizedPublicPath, relativePath),
          source: fs.readFileSync(filePath),
        });
      }
    },
    generateBundle() {
      if (command !== "build") {
        return;
      }

      hostEntries.forEach((entry, index) => {
        const referenceId = hostEntryReferences.get(entry.specifier);
        if (!referenceId) {
          throw new Error(`Missing emitted host entry for ${entry.specifier}`);
        }

        const wrapperFileName = path.posix.join(
          HOST_PUBLIC_PATH,
          `${index}.js`,
        );
        const targetFileName = this.getFileName(referenceId);
        const relativeTarget = path.posix.relative(
          path.posix.dirname(wrapperFileName),
          targetFileName,
        );
        const targetSpecifier = relativeTarget.startsWith(".")
          ? relativeTarget
          : `./${relativeTarget}`;
        const defaultReexport = ["react", "react-dom"].includes(entry.specifier)
          ? `export { default } from ${JSON.stringify(targetSpecifier)};\n`
          : "";

        this.emitFile({
          type: "asset",
          fileName: wrapperFileName,
          source: `${defaultReexport}export * from ${JSON.stringify(targetSpecifier)};\n`,
        });
      });
    },
  };
};
