import { spawn } from "node:child_process";
import readline from "node:readline";

const processes = [];
const suppressedWarnings = new Set();

function logLine(line) {
  process.stdout.write(`${line}\n`);
}

function shouldSuppressLine(line) {
  return (
    line.includes("Progress: resolved") ||
    (line.includes("reused") &&
      line.includes("downloaded") &&
      line.includes("added")) ||
    line.includes("transforming (")
  );
}

function emitLine(name, line) {
  const trimmed = line.trim();
  if (!trimmed || shouldSuppressLine(trimmed)) {
    return;
  }

  if (trimmed.includes("The CJS build of Vite's Node API is deprecated.")) {
    const key = "vite-cjs-node-api-deprecated";
    if (suppressedWarnings.has(key)) {
      return;
    }

    suppressedWarnings.add(key);
    logLine(
      "[watch-library] Vite CJS Node API deprecation warning suppressed after first occurrence",
    );
    return;
  }

  if (
    name === "types" &&
    trimmed.includes("Starting compilation in watch mode")
  ) {
    logLine("[watch-library] type declarations watching");
    return;
  }

  if (
    name === "types" &&
    trimmed.includes("Found 0 errors. Watching for file changes.")
  ) {
    logLine("[watch-library] type declarations ready");
    return;
  }

  if (name === "bundle" && trimmed.includes("watching for file changes")) {
    logLine("[watch-library] library bundle watching");
    return;
  }

  logLine(trimmed);
}

function pipeOutput(name, stream) {
  if (!stream) {
    return;
  }

  const rl = readline.createInterface({ input: stream });
  rl.on("line", (line) => emitLine(name, line));
}

function run(name, command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  pipeOutput(name, child.stdout);
  pipeOutput(name, child.stderr);

  child.on("exit", (code, signal) => {
    if (signal) {
      return;
    }

    if (code && code !== 0) {
      console.error(`[watch-library] ${name} exited with code ${code}`);
      shutdown(code);
    }
  });

  processes.push(child);
}

function shutdown(exitCode = 0) {
  for (const child of processes) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  process.exit(exitCode);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("types", "pnpm", [
  "exec",
  "tsc",
  "-p",
  "tsconfig.lib.json",
  "--watch",
  "--preserveWatchOutput",
]);

run("rewrite-types", "node", [
  "scripts/rewrite-library-dts-paths.mjs",
  "--watch",
]);

run("pack", "node", ["scripts/pack-library.mjs", "--watch"]);

run("bundle", "pnpm", [
  "exec",
  "vite",
  "build",
  "--config",
  "vite.library.config.ts",
  "--mode",
  "library-dev",
  "--watch",
]);
