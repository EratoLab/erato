import fs from "node:fs";
import path from "node:path";

const officeAddinDir = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(officeAddinDir, "dist");
const manifestNames = ["manifest.xml", "manifest-exchange-server.xml"];

fs.mkdirSync(outputDir, { recursive: true });

for (const manifestName of manifestNames) {
  fs.copyFileSync(
    path.join(officeAddinDir, "manifests", manifestName),
    path.join(outputDir, manifestName),
  );
}
