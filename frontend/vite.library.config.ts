import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { lingui } from "@lingui/vite-plugin";
import path from "node:path";

import { createVoiceRuntimePackageAssetsPlugin } from "./vite.voice-runtime-assets";

export default defineConfig(({ mode }) => {
  const isLibraryDevBuild = mode === "library-dev";

  return {
    plugins: [
      react({
        babel: {
          plugins: ["@lingui/babel-plugin-lingui-macro"],
        },
      }),
      lingui(),
      createVoiceRuntimePackageAssetsPlugin({
        rootDir: __dirname,
        outputBasePath: "voice-runtime",
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      outDir: "dist-library",
      emptyOutDir: false,
      sourcemap: isLibraryDevBuild ? "inline" : true,
      minify: isLibraryDevBuild ? false : "esbuild",
      lib: {
        entry: path.resolve(__dirname, "./src/library/index.ts"),
        formats: ["es"],
        fileName: () => "library.js",
        cssFileName: "style",
      },
      rollupOptions: {
        external: [
          "react",
          "react-dom",
          "react/jsx-runtime",
          "react-router",
          "react-router-dom",
          "@lingui/core",
          "@lingui/react",
          "@tanstack/query-core",
          "@tanstack/react-query",
          "@tanstack/react-query-devtools",
        ],
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  };
});
