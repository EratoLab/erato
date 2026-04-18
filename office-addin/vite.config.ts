import fs from "node:fs";
import path from "node:path";

import { lingui } from "@lingui/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type ViteDevServer } from "vite";

const loadOfficeAddinEnv = (mode: string) => {
  const developmentEnv =
    mode === "development" ? {} : loadEnv("development", __dirname, "");
  const modeEnv = loadEnv(mode, __dirname, "");

  return {
    ...developmentEnv,
    ...modeEnv,
  };
};

const copy404Plugin = () => {
  return {
    name: "copy-404",
    writeBundle(options: { dir?: string }) {
      const outDir = options.dir ?? "dist";
      const indexPath = path.join(outDir, "index.html");
      const notFoundPath = path.join(outDir, "404.html");

      if (fs.existsSync(indexPath)) {
        fs.copyFileSync(indexPath, notFoundPath);
        console.log("✓ Copied index.html to 404.html");
      }
    },
  };
};

const stagePlatformLocalesPlugin = () => {
  const rootDir = __dirname;
  const sourceRoot = path.join(rootDir, "src", "locales");
  const targetRoot = path.join(rootDir, "public", "locales");
  const supportedLocales = ["en", "de", "fr", "pl", "es"];

  const stage = () => {
    for (const locale of supportedLocales) {
      const targetDir = path.join(targetRoot, locale);
      fs.mkdirSync(targetDir, { recursive: true });

      const sourcePath = path.join(sourceRoot, locale, "messages.json");
      const targetPath = path.join(targetDir, "messages.json");
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, targetPath);
      } else if (!fs.existsSync(targetPath)) {
        fs.writeFileSync(targetPath, JSON.stringify({ messages: {} }, null, 2));
      }
    }
  };

  return {
    name: "stage-platform-locales",
    buildStart() {
      stage();
    },
    configureServer() {
      stage();
    },
  };
};

const watchLinkedFrontendPublicOutputPlugin = (enabled: boolean) => {
  if (!enabled) {
    return {
      name: "watch-linked-frontend-public-output",
    };
  }

  const frontendPublicOutputDir = path.resolve(
    __dirname,
    "../frontend/out/public",
  );
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleReload = (server: ViteDevServer, changedFile: string) => {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
    }

    reloadTimer = setTimeout(() => {
      console.log(
        `[linked-frontend-public-output] Detected rebuilt asset: ${path.relative(
          __dirname,
          changedFile,
        )}; reloading add-in clients`,
      );
      server.ws.send({ type: "full-reload" });
    }, 150);
  };

  return {
    name: "watch-linked-frontend-public-output",
    configureServer(server: ViteDevServer) {
      const onOutputChange = (filePath: string) => {
        const resolvedFilePath = path.resolve(filePath);
        if (
          resolvedFilePath !== frontendPublicOutputDir &&
          !resolvedFilePath.startsWith(`${frontendPublicOutputDir}${path.sep}`)
        ) {
          return;
        }

        scheduleReload(server, resolvedFilePath);
      };

      server.watcher.add(frontendPublicOutputDir);
      server.watcher.on("add", onOutputChange);
      server.watcher.on("change", onOutputChange);
      server.watcher.on("unlink", onOutputChange);
    },
  };
};

export default defineConfig(({ mode }) => {
  const env = loadOfficeAddinEnv(mode);
  const apiRootUrl = env.VITE_API_ROOT_URL;
  const linkedFrontend = mode === "linked";
  const isDevServer = mode !== "production";
  const define = Object.fromEntries(
    Object.entries(env)
      .filter(([key]) => key.startsWith("VITE_"))
      .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
  );

  const apiProxy =
    apiRootUrl && !apiRootUrl.startsWith("http://localhost:3002")
      ? {
          "/office-addin/manifest.xml": {
            target: new URL(apiRootUrl).origin,
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
    base: isDevServer ? "/office-addin/" : "/public/platform-office-addin/",
    define,
    plugins: [
      react({
        babel: {
          plugins: ["@lingui/babel-plugin-lingui-macro"],
        },
      }),
      lingui(),
      stagePlatformLocalesPlugin(),
      watchLinkedFrontendPublicOutputPlugin(linkedFrontend),
      copy404Plugin(),
    ],
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
