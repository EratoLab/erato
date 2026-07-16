import path from "node:path";

import { lingui } from "@lingui/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import {
  IMPORT_MAP_MANIFEST_FILE_NAME,
  SHARED_MODULES,
} from "./shared-modules.config";
import { browserOnlyBuildPlugin } from "./vite.browser-only-build";

const componentKitHostManifestPlugin = (): Plugin => ({
  name: "component-kit-host-manifest",
  generateBundle(_options, bundle) {
    const imports: Record<string, string> = Object.fromEntries(
      Object.values(bundle).flatMap((output) => {
        if (output.type !== "chunk" || !output.isEntry) {
          return [];
        }

        const entry = SHARED_MODULES.find(
          (sharedModule) => sharedModule.entryName === output.name,
        );
        return entry ? [[entry.specifier, `./${output.fileName}`]] : [];
      }),
    );
    imports["@erato/frontend/shared"] = "../shared.mjs";

    this.emitFile({
      type: "asset",
      fileName: IMPORT_MAP_MANIFEST_FILE_NAME,
      source: JSON.stringify({ imports }, null, 2),
    });
  },
});

const external = [
  "@lingui/core",
  "@lingui/react",
  "@ricky0123/vad-web",
  "@tanstack/query-core",
  "@tanstack/react-query",
  "@tanstack/react-query-devtools",
  "onnxruntime-web",
  "onnxruntime-web/wasm",
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
  "react-router",
  "react-router-dom",
];

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ["@lingui/babel-plugin-lingui-macro"],
      },
    }),
    lingui(),
    browserOnlyBuildPlugin(),
    componentKitHostManifestPlugin(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist-library/component-kit-host",
    emptyOutDir: true,
    cssCodeSplit: true,
    sourcemap: true,
    lib: {
      entry: Object.fromEntries(
        SHARED_MODULES.filter(
          (entry) => entry.specifier !== "@erato/frontend/shared",
        ).map((entry) => [
          entry.entryName,
          path.resolve(__dirname, "src/shared", entry.file),
        ]),
      ),
      formats: ["es"],
    },
    rollupOptions: {
      external,
      preserveEntrySignatures: "strict",
      output: {
        entryFileNames: "[name].mjs",
        chunkFileNames: "chunks/[name]-[hash].mjs",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
