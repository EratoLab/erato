import fs from "node:fs";
import path from "node:path";

import { lingui } from "@lingui/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// The bundle is embedded in the sidecar binary and served over a custom
// protocol: relative asset URLs, no source maps, one HTML entry per window
// (only the smoke window so far), and nothing that serves or fetches.

const packageVersion = (
  JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8"),
  ) as { version: string }
).version;

// Packages that hold React context or module state shared with the frontend
// library. A second copy of any of them breaks every hook the library calls.
const SHARED_CONTEXT_PACKAGES = [
  "react",
  "react-dom",
  "@lingui/core",
  "@lingui/react",
];

const BLOCKED_DYNAMIC_IMPORT_ID = "\0erato-desktop-ui:blocked-dynamic-import";

// The bundle is embedded whole; nothing loads lazily. The library's dynamic
// imports (file previewers, mermaid, the voice runtime, date-fns locales,
// icon catalogs: some 35 MB of chunks) all resolve to one module that
// rejects on evaluation, so their chunks are never emitted and a caller sees
// the failure it already handles for a missing network resource. The app's
// own code may not use dynamic import at all (eslint no-restricted-syntax).
const blockDynamicImportsPlugin = (): Plugin => ({
  name: "erato-desktop-ui:block-dynamic-imports",
  apply: "build",
  resolveDynamicImport() {
    return BLOCKED_DYNAMIC_IMPORT_ID;
  },
  load(id) {
    if (id !== BLOCKED_DYNAMIC_IMPORT_ID) return null;
    return 'throw new Error("Dynamic imports are disabled in the Erato desktop UI bundle");';
  },
});

export default defineConfig({
  base: "./",
  clearScreen: false,
  define: {
    __DESKTOP_UI_VERSION__: JSON.stringify(packageVersion),
  },
  plugins: [
    react({
      babel: {
        plugins: ["@lingui/babel-plugin-lingui-macro"],
      },
    }),
    lingui(),
    blockDynamicImportsPlugin(),
  ],
  resolve: {
    dedupe: SHARED_CONTEXT_PACKAGES,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rolldownOptions: {
      input: path.resolve(__dirname, "index.html"),
    },
  },
});
