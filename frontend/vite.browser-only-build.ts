import type { Plugin } from "vite";

const BROWSER_ONLY_SERVER_STUB_PREFIX = "\0browser-only-server-stub:";
const DISPLAY_STUB_PREFIX = "browser-only-server-stub:";

const REACT_DOM_SERVER_PATTERN = /^react-dom\/server(?:\.browser)?$/;

const blockedServerSideModules: Array<{
  label: string;
  pattern: RegExp;
}> = [
  {
    label: "React DOM server renderer",
    pattern: REACT_DOM_SERVER_PATTERN,
  },
  {
    label: "React server components runtime",
    pattern: /^react-server-dom-webpack(?:\/|$)/,
  },
  {
    label: "server-only marker package",
    pattern: /^server-only$/,
  },
  {
    label: "Next.js server runtime",
    pattern: /^next\/server$/,
  },
  {
    label: "Node server runtime module",
    pattern:
      /^(?:node:)?(?:async_hooks|child_process|cluster|dgram|diagnostics_channel|dns|fs|http|http2|https|module|net|readline|repl|tls|tty|v8|vm|worker_threads|zlib)(?:\/|$)/,
  },
];

const blockedGeneratedCodePatterns: Array<{
  label: string;
  pattern: RegExp;
}> = [
  {
    label: "React DOM server renderer",
    pattern: /(?:from\s+|import\s*)["']react-dom\/server(?:\.browser)?["']/,
  },
  {
    label: "React server components runtime",
    pattern:
      /(?:from\s+|import\s*)["']react-server-dom-webpack(?:\/[^"']*)?["']/,
  },
  {
    label: "server-only marker package",
    pattern: /(?:from\s+|import\s*)["']server-only["']/,
  },
  {
    label: "Next.js server runtime",
    pattern: /(?:from\s+|import\s*)["']next\/server["']/,
  },
  {
    label: "Node server runtime module",
    pattern:
      /(?:from\s+|import\s*)["'](?:node:)?(?:async_hooks|child_process|cluster|dgram|diagnostics_channel|dns|fs|http|http2|https|module|net|readline|repl|tls|tty|v8|vm|worker_threads|zlib)(?:\/[^"']*)?["']/,
  },
];

const stripQueryAndHash = (id: string): string => id.split(/[?#]/, 1)[0];

const matchBlockedServerSideModule = (id: string) => {
  const normalizedId = stripQueryAndHash(id);
  return blockedServerSideModules.find(({ pattern }) =>
    pattern.test(normalizedId),
  );
};

const formatImporter = (importer: string | undefined): string =>
  importer ? ` imported by ${importer}` : "";

const reactDomServerStub = (moduleId: string): string => {
  const reactDomServerExports = [
    "renderToString",
    "renderToStaticMarkup",
    "renderToPipeableStream",
    "renderToReadableStream",
    "resume",
    "resumeToPipeableStream",
    "prerender",
    "prerenderToNodeStream",
  ];

  return [
    `const unavailable = (exportName) => {`,
    `  throw new Error(${JSON.stringify(
      `${moduleId} is not available in the browser-only frontend library build`,
    )});`,
    `};`,
    ...reactDomServerExports.map(
      (exportName) =>
        `export const ${exportName} = () => unavailable(${JSON.stringify(
          exportName,
        )});`,
    ),
    `export const version = "browser-only-stub";`,
    `export default new Proxy({}, {`,
    `  get(_target, property) {`,
    `    throw new Error(${JSON.stringify(
      `${moduleId}.`,
    )} + String(property) + ${JSON.stringify(
      " is not available in the browser-only frontend library build",
    )});`,
    `  },`,
    `});`,
  ].join("\n");
};

export const browserOnlyBuildPlugin = (): Plugin => ({
  name: "browser-only-build",
  enforce: "pre",
  resolveId(source, importer) {
    const blockedModule = matchBlockedServerSideModule(source);
    if (!blockedModule) {
      return null;
    }

    if (REACT_DOM_SERVER_PATTERN.test(source)) {
      return `${BROWSER_ONLY_SERVER_STUB_PREFIX}${source}`;
    }

    this.error(
      `${blockedModule.label} module "${source}" cannot be bundled into the browser-only frontend library build${formatImporter(
        importer,
      )}.`,
    );
  },
  load(id) {
    if (!id.startsWith(BROWSER_ONLY_SERVER_STUB_PREFIX)) {
      return null;
    }

    return reactDomServerStub(id.slice(BROWSER_ONLY_SERVER_STUB_PREFIX.length));
  },
  generateBundle(_options, bundle) {
    for (const output of Object.values(bundle)) {
      if (output.type !== "chunk") {
        continue;
      }

      for (const importedModuleId of [
        ...output.imports,
        ...output.dynamicImports,
      ]) {
        const displayModuleId = importedModuleId.replace(
          BROWSER_ONLY_SERVER_STUB_PREFIX,
          DISPLAY_STUB_PREFIX,
        );
        const blockedModule = matchBlockedServerSideModule(importedModuleId);
        if (blockedModule) {
          this.error(
            `${blockedModule.label} module "${displayModuleId}" leaked into generated chunk "${output.fileName}".`,
          );
        }
      }

      for (const { label, pattern } of blockedGeneratedCodePatterns) {
        if (pattern.test(output.code)) {
          this.error(
            `${label} import leaked into generated chunk "${output.fileName}".`,
          );
        }
      }
    }
  },
});
