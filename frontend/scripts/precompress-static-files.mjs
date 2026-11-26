#!/usr/bin/env node
// Image build step (frontend/Dockerfile): writes `<file>.br` / `<file>.gz`
// next to every file the Vite build manifest lists, when the copy shrinks
// enough. The backend sends these copies only for listed files: their names
// change with their content, so a copy is never older than its file. Every
// other file (pages, translations, fixed-name assets) is compressed by the
// backend per response.
//
// Also checks the promise the backend relies on when it caches listed files
// for a year: each of them has a content hash in its name.
//
// Usage: node scripts/precompress-static-files.mjs <dir> [<dir> ...]

import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";

const brotliCompress = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

const BUILD_MANIFEST = path.join(".vite", "manifest.json");
// Vite's `[name]-[hash]` file names: an 8-character hash before the extension.
const HASHED_FILE_NAME = /-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;
const MIN_SIZE_BYTES = 1024;
// Brotli's top quality takes about a minute for a 20 MB file; one step lower
// is ~15x faster and ~15% larger, which only matters for the few large ones.
const MAX_QUALITY_UP_TO_BYTES = 4 * 1024 * 1024;
// A copy that saves less than this is not worth a second file and a
// negotiation; already compressed formats (images, woff2) end up here.
const MAX_COMPRESSED_RATIO = 0.9;
const CONCURRENCY = 4;

async function readFingerprintedFiles(dir) {
  let manifest;
  try {
    manifest = JSON.parse(
      await fs.readFile(path.join(dir, BUILD_MANIFEST), "utf8"),
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${dir}: no build manifest (${BUILD_MANIFEST})`);
    }
    throw error;
  }
  const files = [
    ...new Set(
      Object.values(manifest).flatMap((entry) => [
        entry.file,
        ...(entry.css ?? []),
        ...(entry.assets ?? []),
      ]),
    ),
  ];
  const unhashed = files.filter((file) => !HASHED_FILE_NAME.test(file));
  if (unhashed.length > 0) {
    throw new Error(
      `${dir}: the build manifest lists files without a content hash in their name, ` +
        `which the backend would cache for a year: ${unhashed.join(", ")}`,
    );
  }
  return files.map((file) => path.join(dir, file));
}

async function precompress(filePath) {
  const source = await fs.readFile(filePath);
  const written = {
    original: source.length,
    br: source.length,
    gz: source.length,
  };
  if (source.length < MIN_SIZE_BYTES) {
    return written;
  }
  const [br, gz] = await Promise.all([
    brotliCompress(source, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]:
          source.length <= MAX_QUALITY_UP_TO_BYTES
            ? zlib.constants.BROTLI_MAX_QUALITY
            : 9,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.length,
      },
    }),
    gzip(source, { level: zlib.constants.Z_BEST_COMPRESSION }),
  ]);
  if (br.length <= source.length * MAX_COMPRESSED_RATIO) {
    await fs.writeFile(`${filePath}.br`, br);
    written.br = br.length;
  }
  if (gz.length <= source.length * MAX_COMPRESSED_RATIO) {
    await fs.writeFile(`${filePath}.gz`, gz);
    written.gz = gz.length;
  }
  return written;
}

async function precompressDirectory(dir) {
  const files = await readFingerprintedFiles(dir);
  const totals = { files: files.length, original: 0, br: 0, gz: 0 };
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < files.length) {
        const result = await precompress(files[next++]);
        totals.original += result.original;
        totals.br += result.br;
        totals.gz += result.gz;
      }
    }),
  );
  return totals;
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error("Usage: precompress-static-files.mjs <dir> [<dir> ...]");
  process.exit(1);
}

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
for (const dir of dirs) {
  const totals = await precompressDirectory(dir);
  console.log(
    `✓ Precompressed ${totals.files} files in ${dir}: ${megabytes(totals.original)} → brotli ${megabytes(totals.br)}, gzip ${megabytes(totals.gz)}`,
  );
}
