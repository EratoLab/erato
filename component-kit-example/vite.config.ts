import fs from "node:fs";
import path from "node:path";

import { defineConfig, type Plugin } from "vite";

const emitCompiledLocaleCatalogs = (): Plugin => {
  const rootDir = __dirname;
  const sourceLocalesDir = path.join(rootDir, "src", "locales");

  return {
    name: "emit-compiled-locale-catalogs",
    generateBundle() {
      if (!fs.existsSync(sourceLocalesDir)) {
        return;
      }

      for (const locale of fs.readdirSync(sourceLocalesDir)) {
        const catalogPath = path.join(
          sourceLocalesDir,
          locale,
          "messages.json",
        );
        if (!fs.existsSync(catalogPath)) {
          continue;
        }

        this.emitFile({
          type: "asset",
          fileName: `locales/${locale}/messages.json`,
          source: fs.readFileSync(catalogPath),
        });
      }
    },
  };
};

/**
 * Shared specifiers stay bare imports in the kit bundle and resolve at
 * runtime through the import map the host emits (backend in production,
 * the frontend dev plugin in `just dev`). One module instance everywhere —
 * host contexts and singletons included.
 */
const SHARED_EXTERNALS = [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom",
  "@lingui/core",
  "@lingui/react",
  "@tanstack/react-query",
  "react-router",
  "react-router-dom",
];

export default defineConfig({
  plugins: [emitCompiledLocaleCatalogs()],
  esbuild: {
    jsx: "automatic",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, "src/index.tsx"),
      formats: ["es"],
    },
    rollupOptions: {
      external: [...SHARED_EXTERNALS, /^@erato\/frontend\/shared\//],
      output: {
        entryFileNames: "index-[hash].js",
        assetFileNames: "style[extname]",
      },
    },
  },
});
