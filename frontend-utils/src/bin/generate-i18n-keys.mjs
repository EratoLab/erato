#!/usr/bin/env node
import { writeI18nKeysManifest } from "../i18n-keys/index.mjs";

const args = process.argv.slice(2);

const readOption = (name) => {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }

  return value;
};

if (args.includes("--help") || args.includes("-h")) {
  console.log(
    [
      "Usage: erato-frontend-i18n-keys --out <path> [--root <path>] [--config <path>]",
      "",
      "Generates an i18n_keys.json manifest from the project's Lingui config.",
    ].join("\n"),
  );
  process.exit(0);
}

const outputPath = readOption("--out") ?? "out/i18n_keys.json";
const rootDir = readOption("--root") ?? process.cwd();
const configPath = readOption("--config");

await writeI18nKeysManifest(outputPath, { configPath, rootDir });
