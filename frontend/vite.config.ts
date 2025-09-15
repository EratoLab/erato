import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { lingui } from "@lingui/vite-plugin";
import path from "node:path";
import fs from "node:fs";

// Custom plugin to copy index.html as 404.html for SPA routing
const copy404Plugin = () => {
  return {
    name: "copy-404",
    writeBundle(options: any) {
      const outDir = options.dir || "out";
      const indexPath = path.join(outDir, "index.html");
      const notFoundPath = path.join(outDir, "404.html");

      if (fs.existsSync(indexPath)) {
        fs.copyFileSync(indexPath, notFoundPath);
        console.log("✓ Copied index.html to 404.html");
      }
    },
  };
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ["@lingui/babel-plugin-lingui-macro"],
      },
    }),
    lingui(),
    copy404Plugin(),
  ],
  server: {
    port: 3000, // You can change this if needed
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "out",
  },
});
