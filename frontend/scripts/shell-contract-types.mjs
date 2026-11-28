// Writes the TypeScript shape of each shell contract schema in
// src/lib/shell/contract (`x.v1.schema.json` → `x.v1.generated.ts`).
// Only the shape is typed: the schema's rules (conditions, counts) are what
// the catalogue tests check with Ajv. `--check` fails instead of writing
// when a file is out of date.
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "json-schema-to-typescript";
import prettier from "prettier";

const contract = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/lib/shell/contract",
);
const check = process.argv.includes("--check");

const RULES = new Set([
  "allOf",
  "if",
  "then",
  "else",
  "dependentRequired",
  "minItems",
  "maxItems",
  "minProperties",
  "contains",
  "minContains",
  "maxContains",
]);
const shapeOf = (node) => {
  if (Array.isArray(node)) return node.map(shapeOf);
  if (node === null || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([keyword]) => !RULES.has(keyword))
      .map(([keyword, value]) => [keyword, shapeOf(value)]),
  );
};

const stale = [];
const schemas = (await readdir(contract))
  .filter((file) => file.endsWith(".schema.json"))
  .sort();
for (const file of schemas) {
  const schema = JSON.parse(await readFile(path.join(contract, file), "utf8"));
  const target = path.join(
    contract,
    file.replace(/\.schema\.json$/, ".generated.ts"),
  );
  const typed = await compile(shapeOf(schema), file, {
    bannerComment: `/* Generated from ${file} by \`pnpm shell:types\`. Do not edit. */`,
    declareExternallyReferenced: true,
    enableConstEnums: false,
    format: false,
    strictIndexSignatures: false,
    unknownAny: true,
  });
  const source = await prettier.format(typed, {
    ...(await prettier.resolveConfig(target)),
    filepath: target,
  });
  if (!check) {
    await writeFile(target, source);
    continue;
  }
  const written = await readFile(target, "utf8").catch(() => "");
  if (written !== source) stale.push(path.relative(process.cwd(), target));
}

if (stale.length > 0) {
  console.error(`Out of date (run \`pnpm shell:types\`): ${stale.join(", ")}`);
  process.exit(1);
}
