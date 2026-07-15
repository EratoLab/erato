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
