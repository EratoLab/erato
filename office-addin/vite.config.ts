import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  const apiRootUrl = env.VITE_API_ROOT_URL;

  const apiProxy =
    apiRootUrl && !apiRootUrl.startsWith("http://localhost:3002")
      ? {
          "/api/": {
            target: new URL(apiRootUrl).origin,
            changeOrigin: true,
            secure: false,
          },
        }
      : undefined;

  return {
    base: "/office-addin/",
    plugins: [react()],
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
