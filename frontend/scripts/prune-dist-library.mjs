/**
 * `vite.library.config.ts` sets `emptyOutDir: false` — it has to, because
 * `tsc -p tsconfig.lib.json` and the component-kit-host build write into the
 * same `dist-library` tree — so nothing ever removes the hashed chunks of
 * previous builds. Left alone the directory grows without bound (measured at
 * 480 MB / 1886 chunks for ERMAIN-565), which inflates `pnpm pack`, the
 * recursive watch and every cold dev-server scan.
 *
 * Only output that the current configs regenerate wholesale is removed, and
 * only between builds — never while one is running, since a loaded page still
 * imports the chunks of the build it was served.
 */
import fs from "node:fs";
import path from "node:path";

const distLibraryDir = path.join(process.cwd(), "dist-library");
const chunksDir = path.join(distLibraryDir, "chunks");
// The library build emits `.mjs`; a top-level `.js`/`.js.map` is left over
// from a superseded output naming.
const ORPHAN_ROOT_FILE_PATTERN = /\.js(\.map)?$/;

const directorySize = (directory) => {
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      total += directorySize(entryPath);
    } else if (entry.isFile()) {
      total += fs.statSync(entryPath).size;
    }
  }

  return total;
};

const formatMegabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const prune = () => {
  if (!fs.existsSync(distLibraryDir)) {
    return 0;
  }

  let reclaimedBytes = 0;

  if (fs.existsSync(chunksDir)) {
    reclaimedBytes += directorySize(chunksDir);
    fs.rmSync(chunksDir, { recursive: true, force: true });
  }

  for (const entry of fs.readdirSync(distLibraryDir, { withFileTypes: true })) {
    if (!entry.isFile() || !ORPHAN_ROOT_FILE_PATTERN.test(entry.name)) {
      continue;
    }

    const entryPath = path.join(distLibraryDir, entry.name);
    reclaimedBytes += fs.statSync(entryPath).size;
    fs.rmSync(entryPath, { force: true });
  }

  return reclaimedBytes;
};

const reclaimedBytes = prune();
if (reclaimedBytes > 0) {
  console.log(
    `[prune-dist-library] reclaimed ${formatMegabytes(reclaimedBytes)} of superseded build output`,
  );
}
