import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";

// Linked mode consumes dist-library directly and never reads the tarball, so
// `dev.py --mode linked` passes --no-pack: packing is pure cost there, and it
// is the step that used to tar a tree two builds were still writing into.
const packDisabled = process.argv.includes("--no-pack");

const RESTART_BASE_DELAY_MS = 1_000;
const RESTART_MAX_DELAY_MS = 30_000;
// A child that stayed up this long counts as recovered, so an unrelated later
// failure starts backing off from scratch again.
const RESTART_BACKOFF_RESET_MS = 30_000;
// A child that keeps dying is not going to recover on its own (a build that
// exhausts the heap, say), and retrying it forever costs a full rebuild every
// time. Give up instead and let the caller decide: office-addin/scripts/dev.py
// keeps the add-in dev server running in linked mode.
const RESTART_MAX_CONSECUTIVE = 3;

// The library bundle peaks just above node's default ~4 GB old-space while
// rendering chunks, so the watch build dies of heap exhaustion on a default
// heap. .github/workflows/docker-build.yml raises it the same way for the same
// build; an inherited NODE_OPTIONS still wins.
const DEFAULT_MAX_OLD_SPACE_SIZE_MB = 8192;

const childEnv = () => {
  const nodeOptions = process.env.NODE_OPTIONS ?? "";
  if (nodeOptions.includes("max-old-space-size")) {
    return process.env;
  }

  return {
    ...process.env,
    NODE_OPTIONS:
      `${nodeOptions} --max-old-space-size=${DEFAULT_MAX_OLD_SPACE_SIZE_MB}`.trim(),
  };
};

const supervisors = [];
const suppressedWarnings = new Set();
let shuttingDown = false;

function logLine(line) {
  process.stdout.write(`${line}\n`);
}

function shouldSuppressLine(line) {
  return (
    line.includes("Progress: resolved") ||
    (line.includes("reused") &&
      line.includes("downloaded") &&
      line.includes("added")) ||
    line.includes("transforming (") ||
    line.endsWith("modules transformed.") ||
    line === "transforming..." ||
    line === "rendering chunks..." ||
    line === "computing gzip size..." ||
    line === "build started..."
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

  if (
    name === "pack" &&
    trimmed.includes("wrote dist-package/erato-frontend.tgz")
  ) {
    logLine("[watch-library] package archive ready");
    return;
  }

  if (
    name === "bundle" &&
    (trimmed.startsWith("vite v") ||
      trimmed.startsWith("dist-library/") ||
      trimmed.startsWith("built in "))
  ) {
    if (trimmed.startsWith("built in ")) {
      logLine("[watch-library] library bundle ready");
    }
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

// SIGTERM/SIGINT reach children directly during an intentional teardown —
// office-addin/scripts/dev.py kills the whole process group — possibly before
// this process's own signal handler has set `shuttingDown`. Anything else
// (SIGABRT from a heap-exhausted build, SIGKILL) is a crash like any other.
const TEARDOWN_SIGNALS = new Set(["SIGTERM", "SIGINT"]);

/**
 * None of these children is expected to exit — they are all watchers — so any
 * exit is a failure and gets restarted with backoff. Taking the whole stack
 * down instead would also kill the add-in dev server, which is the one
 * process that lets a browser recover on its own once the build is fixed.
 */
function start(supervisor) {
  const startedAt = Date.now();
  const child = spawn(supervisor.command, supervisor.args, {
    cwd: process.cwd(),
    env: childEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  supervisor.child = child;
  pipeOutput(supervisor.name, child.stdout);
  pipeOutput(supervisor.name, child.stderr);

  child.on("exit", (code, signal) => {
    supervisor.child = null;
    if (shuttingDown || (signal && TEARDOWN_SIGNALS.has(signal))) {
      return;
    }

    if (Date.now() - startedAt >= RESTART_BACKOFF_RESET_MS) {
      supervisor.restartDelayMs = RESTART_BASE_DELAY_MS;
      supervisor.consecutiveFailures = 0;
    }

    const exitDescription = signal ? `signal ${signal}` : `code ${code}`;
    supervisor.consecutiveFailures += 1;
    if (supervisor.consecutiveFailures > RESTART_MAX_CONSECUTIVE) {
      console.error(
        `[watch-library] ${supervisor.name} failed ${supervisor.consecutiveFailures} times in a row (last exit ${exitDescription}); giving up`,
      );
      shutdown(code ?? 1);
      return;
    }

    const delayMs = supervisor.restartDelayMs;
    console.error(
      `[watch-library] ${supervisor.name} exited with ${exitDescription}; restarting in ${delayMs / 1000}s`,
    );
    supervisor.restartDelayMs = Math.min(delayMs * 2, RESTART_MAX_DELAY_MS);
    supervisor.restartTimer = setTimeout(() => {
      supervisor.restartTimer = null;
      if (!shuttingDown) {
        start(supervisor);
      }
    }, delayMs);
  });
}

function run(name, command, args) {
  const supervisor = {
    name,
    command,
    args,
    child: null,
    restartTimer: null,
    restartDelayMs: RESTART_BASE_DELAY_MS,
    consecutiveFailures: 0,
  };

  supervisors.push(supervisor);
  start(supervisor);
}

function shutdown(exitCode = 0) {
  shuttingDown = true;

  for (const supervisor of supervisors) {
    if (supervisor.restartTimer) {
      clearTimeout(supervisor.restartTimer);
      supervisor.restartTimer = null;
    }
    if (supervisor.child && !supervisor.child.killed) {
      supervisor.child.kill("SIGTERM");
    }
  }

  process.exit(exitCode);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

spawnSync("node", ["scripts/prune-dist-library.mjs"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "inherit", "inherit"],
});

run("component-registry-shared", "node", [
  "scripts/generate-component-registry-shared-exports.mjs",
  "--watch",
]);

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

if (!packDisabled) {
  run("pack", "node", ["scripts/pack-library.mjs", "--watch"]);
}

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

run("component-kit-host", "pnpm", [
  "exec",
  "vite",
  "build",
  "--config",
  "vite.component-kit-host.config.ts",
  "--watch",
]);
