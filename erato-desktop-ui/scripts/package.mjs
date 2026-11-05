// Packs the built bundle (dist/) into the tarball the sidecar embeds.
//
// Archive layout (root "package/", one tarball per version):
//   package/package.json   {name, version, private, files}
//   package/manifest.json  {name, version, commit, totalBytes, files: [{path, sha256, bytes, contentType}]}
//   package/dist/**        the vite output, paths in the manifest start with "dist/"
//
// Fails on any source map and above the size budget. The release directory
// receives erato-desktop-ui-<version>.tgz and a sibling .sha256 file in
// "<hex>  <name>" format, as `shasum -c` reads it.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SIZE_BUDGET_BYTES = 5 * 1024 * 1024;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = path.join(root, "dist");
const releaseDirectory = path.join(root, "release");

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const contentTypeFor = (filePath) =>
  CONTENT_TYPES[path.extname(filePath).toLowerCase()] ??
  "application/octet-stream";

const walk = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    } else {
      throw new Error(`Unsupported entry in dist: ${entryPath}`);
    }
  }
  return files.sort();
};

const fail = (message) => {
  console.error(`package: ${message}`);
  process.exit(1);
};

const packageManifest = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const { name, version } = packageManifest;
if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) {
  fail(`package.json version is not a semver string: ${version}`);
}

const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
if (!/^[0-9a-f]{40}$/.test(commit)) {
  fail(`git rev-parse HEAD did not return a commit: ${commit}`);
}

let distStat;
try {
  distStat = await stat(distDirectory);
} catch {
  fail("dist/ is missing; run `pnpm run build` first");
}
if (!distStat.isDirectory()) {
  fail("dist/ is not a directory");
}

const distFiles = await walk(distDirectory);
if (distFiles.length === 0) {
  fail("dist/ is empty; run `pnpm run build` first");
}
if (!distFiles.includes(path.join(distDirectory, "index.html"))) {
  fail("dist/index.html is missing");
}

const sourceMaps = distFiles.filter((file) => file.endsWith(".map"));
if (sourceMaps.length > 0) {
  fail(
    `source maps must not ship: ${sourceMaps
      .map((file) => path.relative(root, file))
      .join(", ")}`,
  );
}

const files = [];
let totalBytes = 0;
for (const file of distFiles) {
  const bytes = await readFile(file);
  totalBytes += bytes.length;
  files.push({
    path: path.relative(root, file).split(path.sep).join("/"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    contentType: contentTypeFor(file),
  });
}
if (totalBytes > SIZE_BUDGET_BYTES) {
  fail(
    `dist/ is ${totalBytes} bytes, above the ${SIZE_BUDGET_BYTES} byte budget`,
  );
}

const manifest = { name, version, commit, totalBytes, files };

await mkdir(releaseDirectory, { recursive: true });
const stagingDirectory = await mkdtemp(
  path.join(tmpdir(), "erato-desktop-ui-"),
);
const packDirectory = path.join(stagingDirectory, "pack");
const packageDirectory = path.join(stagingDirectory, "package");

try {
  await mkdir(packDirectory);
  await mkdir(packageDirectory);
  await cp(distDirectory, path.join(packageDirectory, "dist"), {
    recursive: true,
  });
  await writeFile(
    path.join(packageDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(packageDirectory, "package.json"),
    `${JSON.stringify(
      { name, version, private: true, files: ["dist", "manifest.json"] },
      null,
      2,
    )}\n`,
    "utf8",
  );

  execFileSync("pnpm", ["pack", "--pack-destination", packDirectory], {
    cwd: packageDirectory,
    stdio: ["ignore", "inherit", "inherit"],
  });

  const packed = (await readdir(packDirectory)).filter((entry) =>
    entry.endsWith(".tgz"),
  );
  if (packed.length !== 1) {
    fail(`pnpm pack produced ${packed.length} archives, expected one`);
  }

  const archiveName = `erato-desktop-ui-${version}.tgz`;
  const archivePath = path.join(releaseDirectory, archiveName);
  await rm(archivePath, { force: true });
  await rename(path.join(packDirectory, packed[0]), archivePath);

  const entries = execFileSync("tar", ["-tzf", archivePath], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((entry) => entry.length > 0);
  const outsideRoot = entries.filter((entry) => !entry.startsWith("package/"));
  if (outsideRoot.length > 0) {
    fail(`archive entries outside package/: ${outsideRoot.join(", ")}`);
  }
  const mapEntries = entries.filter((entry) => entry.endsWith(".map"));
  if (mapEntries.length > 0) {
    fail(`archive contains source maps: ${mapEntries.join(", ")}`);
  }
  const entrySet = new Set(entries);
  const missing = [
    "package/package.json",
    "package/manifest.json",
    ...files.map((file) => `package/${file.path}`),
  ].filter((entry) => !entrySet.has(entry));
  if (missing.length > 0) {
    fail(`archive is missing manifest paths: ${missing.join(", ")}`);
  }

  const archive = await readFile(archivePath);
  const digest = createHash("sha256").update(archive).digest("hex");
  await writeFile(
    path.join(releaseDirectory, `${archiveName}.sha256`),
    `${digest}  ${archiveName}\n`,
    "utf8",
  );

  console.log(`Wrote ${path.relative(root, archivePath)}`);
  console.log(`  version ${version} at ${commit}`);
  console.log(`  ${files.length} files, ${totalBytes} bytes in dist/`);
  console.log(`  archive ${archive.length} bytes, sha256 ${digest}`);
} finally {
  await rm(stagingDirectory, { recursive: true, force: true });
}
