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

export default defineConfig({
  plugins: [emitCompiledLocaleCatalogs()],
  resolve: {
    alias: [
      {
        find: "react/jsx-runtime",
        replacement: path.resolve(
          __dirname,
          "src/runtime/react-jsx-runtime.ts",
        ),
      },
      {
        find: "react/jsx-dev-runtime",
        replacement: path.resolve(
          __dirname,
          "src/runtime/react-jsx-runtime.ts",
        ),
      },
      {
        find: /^react-dom\/server(?:\.browser)?$/,
        replacement: path.resolve(__dirname, "src/runtime/react-dom-server.ts"),
      },
      {
        find: "react-dom",
        replacement: path.resolve(__dirname, "src/runtime/react-dom.ts"),
      },
      {
        find: "react",
        replacement: path.resolve(__dirname, "src/runtime/react.ts"),
      },
    ],
  },
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
