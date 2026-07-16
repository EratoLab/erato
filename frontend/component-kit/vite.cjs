const fs = require("node:fs");
const path = require("node:path");

const manifestPath = path.join(
  __dirname,
  "..",
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

module.exports = {
  eratoComponentKitExternals: Object.freeze(Object.keys(manifest.imports)),
};
