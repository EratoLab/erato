import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDirectory = path.join(root, "release");
const packageManifest = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);

await mkdir(releaseDirectory, { recursive: true });
await new Promise((resolve, reject) => {
  const child = spawn(
    "pnpm",
    ["pack", "--pack-destination", releaseDirectory],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  child.on("error", reject);
  child.on("exit", (code) =>
    code === 0
      ? resolve()
      : reject(new Error(`pnpm pack exited with status ${code}`)),
  );
});

const archiveName = packageArchiveName(
  packageManifest.name,
  packageManifest.version,
);
const archive = await readFile(path.join(releaseDirectory, archiveName));
const checksum = createHash("sha256").update(archive).digest("hex");
const checksumName = `${archiveName}.sha256`;
await writeFile(
  path.join(releaseDirectory, checksumName),
  `${checksum}  ${archiveName}\n`,
  "utf8",
);
console.log(`Wrote release/${archiveName} and release/${checksumName}`);

function packageArchiveName(name, version) {
  return `${name.replace(/^@/, "").replaceAll("/", "-")}-${version}.tgz`;
}
