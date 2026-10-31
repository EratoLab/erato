import fs from "node:fs";
import path from "node:path";

const officeAddinDir = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(officeAddinDir, "dist");
const manifestNames = [
  "manifest.xml",
  "manifest-exchange-server.xml",
  "manifest-document.xml",
  "manifest-teams.json",
];

fs.mkdirSync(outputDir, { recursive: true });

for (const manifestName of manifestNames) {
  // Both Outlook endpoints use one template; the backend selects requirement
  // levels and launch event support by the requested manifest name.
  const templateName =
    manifestName === "manifest-exchange-server.xml"
      ? "manifest.xml"
      : manifestName;
  fs.copyFileSync(
    path.join(officeAddinDir, "manifests", templateName),
    path.join(outputDir, manifestName),
  );
}
