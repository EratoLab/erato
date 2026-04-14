import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  const apiRootUrl = env.VITE_API_ROOT_URL;
  const linkedFrontend = mode === "linked";

  const apiProxy =
    apiRootUrl && !apiRootUrl.startsWith("http://localhost:3002")
      ? {
          "/office-addin/manifest.xml": {
            target: new URL(apiRootUrl).origin,
            changeOrigin: true,
            secure: false,
          },
          "/custom-theme/": {
            target: "http://localhost:3130",
            changeOrigin: true,
            secure: false,
          },
          "/api/": {
            target: new URL(apiRootUrl).origin,
            changeOrigin: true,
            secure: false,
          },
        }
      : undefined;

  return {
    base: "/office-addin/",
    publicDir: path.resolve(__dirname, "../frontend/public"),
    plugins: [react()],
    resolve: linkedFrontend
      ? {
          alias: {
            "@erato/frontend/library": path.resolve(
              __dirname,
              "../frontend/dist-library/library.js",
            ),
            "@erato/frontend/library.css": path.resolve(
              __dirname,
              "../frontend/dist-library/style.css",
            ),
          },
        }
      : undefined,
    server: {
      host: true,
      allowedHosts: [".ts.net"],
      port: 3002,
      proxy: apiProxy,
      fs: {
        allow: [path.resolve(__dirname, "..")],
      },
    },
  };
});
