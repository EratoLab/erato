import path from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
  esbuild: {
    jsxFactory: "h",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, "src/index.tsx"),
      formats: ["es"],
    },
    rollupOptions: {
      output: {
        entryFileNames: "index-[hash].js",
        assetFileNames: "style[extname]",
      },
    },
  },
});
