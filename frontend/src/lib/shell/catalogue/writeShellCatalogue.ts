import fs from "node:fs";
import path from "node:path";

import { i18n } from "@lingui/core";

import { buildSystemMenusCatalogue } from "@/lib/shell/menus/catalogue";

import type { Messages } from "@lingui/core";

/**
 * Writes the catalogue under `outDir` in English, in a folder per capability
 * version that is emptied first, so a removed document goes too. Runs inside
 * the app's own transforms (the Lingui macros), loaded by
 * scripts/shell-catalogue.mjs.
 */
export function writeShellCatalogue({
  outDir,
  messages,
}: {
  outDir: string;
  messages: Messages;
}): { folder: string; files: number } {
  i18n.load("en", messages);
  i18n.activate("en");

  const catalogue = buildSystemMenusCatalogue();
  const folder = path.join(
    outDir,
    `${catalogue.capability}.v${catalogue.version}`,
  );
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });

  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  for (const { name, document } of catalogue.documents) {
    fs.writeFileSync(path.join(folder, `${name}.json`), json(document));
  }
  fs.writeFileSync(
    path.join(folder, "index.json"),
    json({
      capability: catalogue.capability,
      version: catalogue.version,
      menus: catalogue.menus,
      documents: catalogue.documents.map(({ name }) => name),
    }),
  );
  return { folder, files: catalogue.documents.length + 1 };
}
