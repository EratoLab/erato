// Keep the backend Docker context self-contained without duplicating the contract source.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson } from "./lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(
  root,
  "../backend/generated/local_delegation_schemas.json",
);
// The approved export references the Outlook provenance contract, so the
// bundle carries that schema and the ones it references, under their names.
const names = [
  "delegation/binding",
  "delegation/plan",
  "delegation/context-claims",
  "delegation/job-claims",
  "delegation/receipt-claims",
  "delegation/approved-export",
  "outlook/file-provenance",
  "outlook/message-reference",
  "outlook/mailbox-reference",
  "source/external-ids",
];
const documents = Object.fromEntries(
  await Promise.all(
    names.map(async (name) => [
      path.basename(name),
      await readJson(path.join(root, "schemas", `${name}.schema.json`)),
    ]),
  ),
);
documents.common = await readJson(
  path.join(root, "schemas/common.schema.json"),
);
const generated = `${JSON.stringify(documents, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if ((await readFile(output, "utf8")) !== generated) {
    throw new Error("Backend schema bundle is stale; run pnpm run generate.");
  }
} else {
  await writeFile(output, generated, "utf8");
}
