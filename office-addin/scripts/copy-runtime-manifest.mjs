import fs from "node:fs";
import path from "node:path";

const officeAddinDir = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(officeAddinDir, "manifests", "manifest.xml");
const outputDir = path.join(officeAddinDir, "dist");
const outputPath = path.join(outputDir, "manifest.xml");

fs.mkdirSync(outputDir, { recursive: true });
fs.copyFileSync(sourcePath, outputPath);
