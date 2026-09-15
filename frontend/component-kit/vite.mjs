import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifestPath = path.join(
  packageRoot,
  "dist-library",
  "component-kit-host",
  "import-map.manifest.json",
);

if (!fs.existsSync(manifestPath)) {
  throw new Error(
    `Erato component-kit host manifest does not exist: ${manifestPath}. Build @erato/frontend first.`,
  );
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!manifest.imports || typeof manifest.imports !== "object") {
  throw new Error(`Invalid Erato component-kit host manifest: ${manifestPath}`);
}

export const eratoComponentKitExternals = Object.freeze(
  Object.keys(manifest.imports),
);

const packageName = (specifier) =>
  specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];

/**
 * The packages a kit's test build has to resolve to one copy. Derived from the
 * host import map, which is what guarantees the same thing in the browser: a
 * second copy of any of these and the kit's hooks read module instances the
 * host never wrote — "Invalid hook call", or a status store that is not the one
 * the conformance suite writes.
 */
export const eratoComponentKitTestDedupe = Object.freeze([
  ...new Set(
    eratoComponentKitExternals
      .filter((specifier) => !specifier.startsWith("@erato/"))
      .map(packageName),
  ),
]);
