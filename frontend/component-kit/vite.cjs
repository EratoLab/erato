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

const packageName = (specifier) =>
  specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];

module.exports = {
  eratoComponentKitExternals: Object.freeze(Object.keys(manifest.imports)),
  // See the ESM twin for why a kit's test build must dedupe exactly these.
  eratoComponentKitTestDedupe: Object.freeze([
    ...new Set(
      Object.keys(manifest.imports)
        .filter((specifier) => !specifier.startsWith("@erato/"))
        .map(packageName),
    ),
  ]),
};
