import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const distLibraryDir = path.join(rootDir, "dist-library");
const distPackageDir = path.join(rootDir, "dist-package");
const tempPackDir = path.join(distPackageDir, ".tmp");
const outputTarballPath = path.join(distPackageDir, "erato-frontend.tgz");
const outputStatePath = path.join(distPackageDir, "erato-frontend.state.json");
const bundleEntrypointPath = path.join(distLibraryDir, "library.js");
const bundleStylesPath = path.join(distLibraryDir, "style.css");
const watchMode = process.argv.includes("--watch");
const debounceMs = 500;
const maxWaitForBundleMs = 10000;

let isPacking = false;
let settleTimer = null;
let cycleStartedAt = 0;
let lastEventAt = 0;
let lastPackedBundleStamp = 0;

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function writePackageState(tarballPath) {
  const tarballStat = fs.statSync(tarballPath);
  const state = {
    sha256: sha256(tarballPath),
    size: tarballStat.size,
    tarballPath: path.relative(rootDir, tarballPath),
    updatedAt: new Date().toISOString(),
  };
  const tempStatePath = `${outputStatePath}.tmp`;
  fs.writeFileSync(tempStatePath, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tempStatePath, outputStatePath);
}

function getFileMtimeMs(filePath) {
  if (!fs.existsSync(filePath)) {
    return 0;
  }

  return fs.statSync(filePath).mtimeMs;
}

function getBundleStamp() {
  return Math.max(
    getFileMtimeMs(bundleEntrypointPath),
    getFileMtimeMs(bundleStylesPath),
  );
}

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
  if (!fs.existsSync(bundleEntrypointPath)) {
    return;
  }

  fs.mkdirSync(tempPackDir, { recursive: true });
  fs.mkdirSync(distPackageDir, { recursive: true });

  for (const packFile of listPackFiles()) {
    fs.rmSync(packFile, { force: true });
  }

  const result = spawnSync(
    "pnpm",
    ["pack", "--pack-destination", tempPackDir, "--loglevel=error"],
    {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.status !== 0) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    process.exit(result.status ?? 1);
  }

  const packFiles = listPackFiles();
  if (packFiles.length !== 1) {
    console.error("[pack-library] expected exactly one tarball output");
    process.exit(1);
  }

  fs.copyFileSync(packFiles[0], outputTarballPath);
  writePackageState(outputTarballPath);
  lastPackedBundleStamp = getBundleStamp();
  console.log(
    `[pack-library] wrote ${path.relative(rootDir, outputTarballPath)}`,
  );
}

packageLibrary();

if (watchMode) {
  fs.mkdirSync(distLibraryDir, { recursive: true });
  lastPackedBundleStamp = getBundleStamp();

  const schedulePack = () => {
    if (!cycleStartedAt) {
      cycleStartedAt = Date.now();
    }
    lastEventAt = Date.now();

    if (settleTimer) {
      clearTimeout(settleTimer);
    }

    settleTimer = setTimeout(runScheduledPack, debounceMs);
  };

  const runScheduledPack = () => {
    settleTimer = null;
    if (isPacking || !cycleStartedAt) {
      return;
    }

    const now = Date.now();
    const idleMs = now - lastEventAt;
    if (idleMs < debounceMs) {
      settleTimer = setTimeout(runScheduledPack, debounceMs - idleMs);
      return;
    }

    const bundleUpdated = getBundleStamp() > lastPackedBundleStamp;
    const waitedLongEnough = now - cycleStartedAt >= maxWaitForBundleMs;
    if (!bundleUpdated && !waitedLongEnough) {
      settleTimer = setTimeout(runScheduledPack, debounceMs);
      return;
    }

    isPacking = true;

    try {
      packageLibrary();
    } finally {
      isPacking = false;
      cycleStartedAt = 0;
    }
  };

  fs.watch(distLibraryDir, { recursive: true }, () => {
    schedulePack();
  });
}
