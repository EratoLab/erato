import fs from "node:fs";
import path from "node:path";

import { eratoComponentKitExternals } from "@erato/frontend/component-kit/vite";
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
      // The frontend package owns this list alongside its generated import
      // map, so kit externals cannot drift from the host contract.
      external: [...eratoComponentKitExternals],
      output: {
        entryFileNames: "index-[hash].js",
        assetFileNames: "style[extname]",
      },
    },
  },
});
