import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { lingui } from "@lingui/vite-plugin";
import path from "node:path";

import { libraryBuildStatusPlugin } from "./library-build-status";
import { browserOnlyBuildPlugin } from "./vite.browser-only-build";
import {
  iconCatalogManualChunk,
  iconCatalogPlugin,
} from "./vite.icon-catalogs";
import { createVoiceRuntimePackageAssetsPlugin } from "./vite.voice-runtime-assets";

const DIST_LIBRARY_DIR = path.resolve(__dirname, "dist-library");

export default defineConfig(({ mode }) => {
  const isLibraryDevBuild = mode === "library-dev";

  return {
    base: "./",
    plugins: [
      react({
        babel: {
          plugins: ["@lingui/babel-plugin-lingui-macro"],
        },
      }),
      lingui(),
      iconCatalogPlugin({ rootDir: __dirname }),
      createVoiceRuntimePackageAssetsPlugin({
        rootDir: __dirname,
        outputBasePath: "voice-runtime",
      }),
      browserOnlyBuildPlugin(),
      libraryBuildStatusPlugin({
        distLibraryDir: DIST_LIBRARY_DIR,
        key: "library",
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    worker: {
      format: "es",
    },
    build: {
      outDir: "dist-library",
      emptyOutDir: false,
      // Always EXTERNAL sourcemaps: an inline map is one colossal base64
      // line that overflows the regex stack of vite's stripLiteral scan
      // (worker-import-meta-url) when the linked add-in dev server transforms
      // the bundle. External .map keeps identical debuggability.
      sourcemap: true,
      minify: isLibraryDevBuild ? false : "esbuild",
      lib: {
        // `shared` is the component-kit host surface (@erato/frontend/shared).
        // Building it as a sibling entry of the same compilation means both
        // entries share chunk module instances — a consumer importing the
        // library AND exposing the shared surface (the office add-in) hands
        // kits the exact modules its own UI runs on.
        entry: {
          library: path.resolve(__dirname, "./src/library/index.ts"),
          shared: path.resolve(__dirname, "./src/shared/index.ts"),
          // `teams` is the transcript format contract (@erato/frontend/teams):
          // data with no React or DOM behind it, so a producer that only reads
          // or writes the format does not pull the component barrel in to get
          // at a constant.
          teams: path.resolve(__dirname, "./src/utils/teams/index.ts"),
        },
        formats: ["es"],
        fileName: (_format, entryName) =>
          entryName === "library" ? "library.mjs" : `${entryName}.mjs`,
        cssFileName: "style",
      },
      rollupOptions: {
        external: [
          "react",
          "react-dom",
          "react-dom/client",
          "react/jsx-runtime",
          "react-router",
          "react-router-dom",
          "@lingui/core",
          "@lingui/react",
          "@tanstack/query-core",
          "@tanstack/react-query",
          "@tanstack/react-query-devtools",
          "@ricky0123/vad-web",
          "onnxruntime-web",
          "onnxruntime-web/wasm",
        ],
        // Multi-entry rules out inlineDynamicImports; shared chunks carry the
        // module instances both entries reference.
        output: {
          chunkFileNames: "chunks/[name]-[hash].mjs",
          onlyExplicitManualChunks: true,
          manualChunks: iconCatalogManualChunk,
        },
        preserveEntrySignatures: "allow-extension" as const,
      },
    },
  };
});
