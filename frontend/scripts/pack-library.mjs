import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const distLibraryDir = path.join(rootDir, "dist-library");
const distPackageDir = path.join(rootDir, "dist-package");
const tempPackDir = path.join(distPackageDir, ".tmp");
const outputTarballPath = path.join(distPackageDir, "erato-frontend.tgz");
const watchMode = process.argv.includes("--watch");

function listPackFiles() {
  if (!fs.existsSync(tempPackDir)) {
    return [];
  }

  return fs
    .readdirSync(tempPackDir)
    .filter((entry) => entry.endsWith(".tgz"))
    .map((entry) => path.join(tempPackDir, entry));
}

function packageLibrary() {
  const libraryEntrypoint = path.join(distLibraryDir, "library.js");
  if (!fs.existsSync(libraryEntrypoint)) {
    return;
  }

  fs.mkdirSync(tempPackDir, { recursive: true });
  fs.mkdirSync(distPackageDir, { recursive: true });

  for (const packFile of listPackFiles()) {
    fs.rmSync(packFile, { force: true });
  }

  const result = spawnSync(
    "pnpm",
    ["pack", "--pack-destination", tempPackDir],
    {
      cwd: rootDir,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  const packFiles = listPackFiles();
  if (packFiles.length !== 1) {
    console.error("[pack-library] expected exactly one tarball output");
    process.exit(1);
  }

  fs.copyFileSync(packFiles[0], outputTarballPath);
  console.log(
    `[pack-library] wrote ${path.relative(rootDir, outputTarballPath)}`,
  );
}

packageLibrary();

if (watchMode) {
  fs.mkdirSync(distLibraryDir, { recursive: true });

  let timer = null;
  const schedulePack = () => {
    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      packageLibrary();
      timer = null;
    }, 200);
  };

  fs.watch(distLibraryDir, { recursive: true }, () => {
    schedulePack();
  });
}
