import { spawn } from "node:child_process";

const processes = [];

function run(name, command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

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
