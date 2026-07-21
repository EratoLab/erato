import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listFiles } from "./lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), "erato-sidecar-generated-"),
);
const temporaryGenerated = path.join(temporaryRoot, "generated");
const temporaryDist = path.join(temporaryRoot, "dist");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with status ${code}`));
    });
  });
}

try {
  await run(process.execPath, [
    "scripts/generate.mjs",
    "--output-dir",
    temporaryGenerated,
  ]);
  const committedDirectory = path.join(root, "typescript", "src", "generated");
  await compareDirectories(
    temporaryGenerated,
    committedDirectory,
    "Generated TypeScript and validators",
  );
  await run(process.execPath, [
    path.join(root, "node_modules", "typescript", "bin", "tsc"),
    "-p",
    "tsconfig.json",
    "--outDir",
    temporaryDist,
  ]);
  console.log(
    "Generated TypeScript and validators are up to date; compilation succeeded.",
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function compareDirectories(
  generatedDirectory,
  committedDirectory,
  label,
) {
  const generatedFiles = await listFiles(generatedDirectory);
  const committedFiles = await listFiles(committedDirectory);
  const generatedNames = generatedFiles.map((filePath) =>
    path.relative(generatedDirectory, filePath),
  );
  const committedNames = committedFiles.map((filePath) =>
    path.relative(committedDirectory, filePath),
  );
  if (JSON.stringify(generatedNames) !== JSON.stringify(committedNames)) {
    throw new Error(`${label} file set is stale; run pnpm run generate.`);
  }
  for (const relativePath of generatedNames) {
    const generated = await readFile(
      path.join(generatedDirectory, relativePath),
    );
    const committed = await readFile(
      path.join(committedDirectory, relativePath),
    );
    if (!generated.equals(committed)) {
      throw new Error(
        `${label} file ${relativePath} is stale; run pnpm run generate.`,
      );
    }
  }
}
