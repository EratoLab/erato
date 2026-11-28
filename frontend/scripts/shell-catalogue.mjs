#!/usr/bin/env node
/**
 * Writes the catalogue of everything the page can send to a host app's shell
 * capabilities, one JSON file per request or answer, for a host's own tests:
 *
 *   pnpm shell:catalogue [--out <dir>]
 *
 * Default output: shell-catalogue/ next to this package, with a folder per
 * capability version (systemMenus.v1/) and an index.json in it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const outArgument = process.argv.indexOf("--out");
const outValue = outArgument === -1 ? undefined : process.argv[outArgument + 1];
if (outArgument !== -1 && !outValue) {
  console.error("--out needs a folder.");
  process.exit(1);
}
const outDir = path.resolve(outValue ?? path.join(rootDir, "shell-catalogue"));

const messagesPath = path.join(rootDir, "src/locales/en/messages.json");
if (!fs.existsSync(messagesPath)) {
  console.error(
    `${path.relative(rootDir, messagesPath)} is missing; run pnpm i18n:compile first.`,
  );
  process.exit(1);
}

const server = await createServer({
  root: rootDir,
  configFile: path.join(rootDir, "vitest.config.ts"),
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const { writeShellCatalogue } = await server.ssrLoadModule(
    "/src/lib/shell/catalogue/writeShellCatalogue.ts",
  );
  const { messages } = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
  for (const { folder, files } of writeShellCatalogue({ outDir, messages })) {
    console.log(`${path.relative(process.cwd(), folder)}: ${files} files`);
  }
} finally {
  await server.close();
}
