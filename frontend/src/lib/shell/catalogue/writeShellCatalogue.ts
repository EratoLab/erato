import fs from "node:fs";
import path from "node:path";

import { i18n } from "@lingui/core";

import { buildSystemMenusCatalogue } from "@/lib/shell/menus/catalogue";

import type { CapabilityCatalogue } from "./capabilityCatalogue";
import type { Messages } from "@lingui/core";

/** Every capability's catalogue; a new capability adds its builder here. */
const SHELL_CATALOGUES: readonly (() => CapabilityCatalogue)[] = [
  buildSystemMenusCatalogue,
];

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
}): { folder: string; files: number }[] {
  i18n.load("en", messages);
  i18n.activate("en");

  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  return SHELL_CATALOGUES.map((build) => {
    const { capability, version, documents, index } = build();
    const folder = path.join(outDir, `${capability}.v${version}`);
    fs.rmSync(folder, { recursive: true, force: true });
    fs.mkdirSync(folder, { recursive: true });
    for (const { name, document } of documents) {
      fs.writeFileSync(path.join(folder, `${name}.json`), json(document));
    }
    fs.writeFileSync(
      path.join(folder, "index.json"),
      json({
        capability,
        version,
        ...index,
        documents: documents.map(({ name }) => name),
      }),
    );
    return { folder, files: documents.length + 1 };
  });
}
