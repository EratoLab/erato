#!/usr/bin/env node
// Writes `<file>.br` and `<file>.gz` next to every compressible file of a
// built frontend, so the backend can send them compressed without spending
// CPU per request. HTML is left out: the backend rewrites it while serving.
//
// Usage: node scripts/precompress-static-files.mjs <dir> [<dir> ...]

import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";

const brotliCompress = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

const COMPRESSIBLE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".json",
  ".svg",
  ".wasm",
  ".xml",
  ".txt",
  ".ico",
  ".ttf",
  ".otf",
  ".onnx",
  ".webmanifest",
]);
const MIN_SIZE_BYTES = 1024;
// Brotli's top quality takes about a minute for the 20 MB voice runtime; one
// step lower is ~15x faster and ~15% larger, which only matters for files
// that rarely change.
const MAX_QUALITY_UP_TO_BYTES = 4 * 1024 * 1024;
// A copy that saves less than this is not worth a second file and a negotiation.
const MAX_COMPRESSED_RATIO = 0.9;
const CONCURRENCY = 4;

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(entryPath);
    } else if (entry.isFile()) {
      yield entryPath;
    }
  }
}

async function precompress(filePath) {
  const source = await fs.readFile(filePath);
  if (source.length < MIN_SIZE_BYTES) {
    return { original: source.length, br: source.length, gz: source.length };
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
  const written = { original: source.length, br: source.length, gz: source.length };
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
  const files = [];
  for await (const filePath of walk(dir)) {
    if (COMPRESSIBLE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
      files.push(filePath);
    }
  }

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
