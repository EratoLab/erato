import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDirectory = path.join(root, "release");
const releaseEntries = [
  "README.md",
  "DISTRIBUTION.md",
  "SPEC.md",
  "TRANSPORT.md",
  "openrpc.json",
  "schemas",
  "examples",
  "conformance",
];

await mkdir(releaseDirectory, { recursive: true });
const stagingDirectory = await mkdtemp(
  path.join(tmpdir(), "erato-sidecar-spec-"),
);

try {
  const packageManifest = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const releaseManifest = {
    name: `${packageManifest.name}-spec`,
    version: packageManifest.version,
    private: packageManifest.private,
    description: "Language-neutral Erato desktop sidecar protocol contracts",
    files: releaseEntries,
  };

  await Promise.all(
    releaseEntries.map((entry) =>
      cp(path.join(root, entry), path.join(stagingDirectory, entry), {
        recursive: true,
      }),
    ),
  );
  await writeFile(
    path.join(stagingDirectory, "package.json"),
    `${JSON.stringify(releaseManifest, null, 2)}\n`,
    "utf8",
  );

  await new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["pack", "--pack-destination", releaseDirectory],
      {
        cwd: stagingDirectory,
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
    releaseManifest.name,
    releaseManifest.version,
  );
  const archive = await readFile(path.join(releaseDirectory, archiveName));
  validateArchiveEntries(archive, packageManifest.version);
  const checksum = createHash("sha256").update(archive).digest("hex");
  const checksumName = `${archiveName}.sha256`;
  await writeFile(
    path.join(releaseDirectory, checksumName),
    `${checksum}  ${archiveName}\n`,
    "utf8",
  );
  console.log(`Wrote release/${archiveName} and release/${checksumName}`);
} finally {
  await rm(stagingDirectory, { recursive: true, force: true });
}

function packageArchiveName(name, version) {
  return `${name.replace(/^@/, "").replaceAll("/", "-")}-${version}.tgz`;
}

function validateArchiveEntries(archive, version) {
  const entries = listTarEntries(gunzipSync(archive));
  const unexpectedRoots = entries.filter(
    (entry) => !entry.startsWith("package/"),
  );
  if (unexpectedRoots.length > 0) {
    throw new Error(
      `Release entries must use the stable package/ root: ${unexpectedRoots.join(", ")}`,
    );
  }

  const versionedDirectories = entries.filter((entry) =>
    entry.split("/").slice(0, -1).includes(version),
  );
  if (versionedDirectories.length > 0) {
    throw new Error(
      `Release directories must not contain the package version: ${versionedDirectories.join(", ")}`,
    );
  }

  const codeEntries = entries.filter((entry) =>
    /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i.test(entry),
  );
  if (codeEntries.length > 0) {
    throw new Error(
      `Release archive must not contain JavaScript or TypeScript: ${codeEntries.join(", ")}`,
    );
  }
}

function listTarEntries(tar) {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    entries.push(prefix ? `${prefix}/${name}` : name);

    const size = Number.parseInt(readTarString(header, 124, 12), 8) || 0;
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function readTarString(header, offset, length) {
  return header
    .subarray(offset, offset + length)
    .toString("utf8")
    .replace(/\0.*$/s, "")
    .trim();
}
