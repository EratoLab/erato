/**
 * Completion signal for the builds that write into `dist-library`, shared by
 * the producers (this package's library and component-kit-host builds) and the
 * consumer that serves those files in linked dev mode (the office add-in).
 *
 * `dist-library/library.mjs` is a single entry chunk whose named-export block
 * sits in its last few percent, so a reader that fires on the first byte
 * written gets valid-but-exportless JS and an unrecoverable module-link error.
 * File mtimes cannot distinguish "written" from "being written", and cannot
 * express that the entry and its hashed chunks belong to the same build, so
 * each build publishes its own state here instead.
 *
 * Both status files live at the `dist-library` root because
 * `vite.component-kit-host.config.ts` empties its own output directory.
 *
 * Like `component-kit-host.plugins.ts`, the plugin shape is typed structurally
 * rather than importing vite types: each host resolves its own vite instance,
 * and nominal types from this package's copy would not be assignable to the
 * other host's `defineConfig`.
 */
import fs from "node:fs";
import path from "node:path";

export type LibraryBuildState = "building" | "ready" | "failed";

export interface LibraryBuildStatus {
  state: LibraryBuildState;
  /** Epoch milliseconds, from the same clock every reader compares against. */
  updatedAt: number;
}

export const LIBRARY_BUILD_STATUS_FILE_NAMES = {
  library: ".build-status.library.json",
  "component-kit-host": ".build-status.component-kit-host.json",
} as const;

export type LibraryBuildKey = keyof typeof LIBRARY_BUILD_STATUS_FILE_NAMES;

export const LIBRARY_BUILD_KEYS = Object.keys(
  LIBRARY_BUILD_STATUS_FILE_NAMES,
) as LibraryBuildKey[];

/**
 * A build that neither completed nor failed within this window left its status
 * behind (killed mid-build), so readers stop treating it as in flight.
 */
export const LIBRARY_BUILD_STALE_AFTER_MS = 120_000;

export const libraryBuildStatusPath = (
  distLibraryDir: string,
  key: LibraryBuildKey,
): string => path.join(distLibraryDir, LIBRARY_BUILD_STATUS_FILE_NAMES[key]);

export const parseLibraryBuildStatus = (
  contents: string,
): LibraryBuildStatus | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const { state, updatedAt } = parsed as Record<string, unknown>;
  if (state !== "building" && state !== "ready" && state !== "failed") {
    return null;
  }
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) {
    return null;
  }

  return { state, updatedAt };
};

export const readLibraryBuildStatus = (
  distLibraryDir: string,
  key: LibraryBuildKey,
): LibraryBuildStatus | null => {
  try {
    return parseLibraryBuildStatus(
      fs.readFileSync(libraryBuildStatusPath(distLibraryDir, key), "utf8"),
    );
  } catch {
    return null;
  }
};

export const readLibraryBuildStatuses = (
  distLibraryDir: string,
): Partial<Record<LibraryBuildKey, LibraryBuildStatus>> =>
  Object.fromEntries(
    LIBRARY_BUILD_KEYS.flatMap((key) => {
      const status = readLibraryBuildStatus(distLibraryDir, key);
      return status ? [[key, status] as const] : [];
    }),
  );

export const isLibraryBuildInFlight = (
  statuses: Partial<Record<LibraryBuildKey, LibraryBuildStatus>>,
  now: number,
): boolean =>
  Object.values(statuses).some(
    (status) =>
      status.state === "building" &&
      now - status.updatedAt < LIBRARY_BUILD_STALE_AFTER_MS,
  );

/**
 * Changes whenever any build transitions, so a consumer can tell a rebuild it
 * has not reacted to from a status file it has merely re-read.
 */
export const libraryBuildStatusFingerprint = (
  statuses: Partial<Record<LibraryBuildKey, LibraryBuildStatus>>,
): string =>
  LIBRARY_BUILD_KEYS.map((key) => {
    const status = statuses[key];
    return status ? `${key}:${status.state}:${status.updatedAt}` : `${key}:-`;
  }).join("|");

type BuildStatusPluginLike = {
  name: string;
  buildStart(): void;
  buildEnd(error?: unknown): void;
  renderError(): void;
  writeBundle(): void;
};

const writeStatus = (statusPath: string, state: LibraryBuildState): void => {
  const status: LibraryBuildStatus = { state, updatedAt: Date.now() };
  const temporaryPath = `${statusPath}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(temporaryPath, `${JSON.stringify(status)}\n`);
    // Rename so a reader never observes a half-written status.
    fs.renameSync(temporaryPath, statusPath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    console.warn(`[library-build-status] could not write ${statusPath}`, error);
  }
};

export const libraryBuildStatusPlugin = (options: {
  distLibraryDir: string;
  key: LibraryBuildKey;
}): BuildStatusPluginLike => {
  const statusPath = libraryBuildStatusPath(
    options.distLibraryDir,
    options.key,
  );

  return {
    name: `library-build-status-${options.key}`,
    buildStart() {
      writeStatus(statusPath, "building");
    },
    buildEnd(error?: unknown) {
      if (error) {
        writeStatus(statusPath, "failed");
      }
    },
    // Output-phase errors (renderChunk, generateBundle) never reach buildEnd —
    // rollup reports them here instead.
    renderError() {
      writeStatus(statusPath, "failed");
    },
    writeBundle() {
      writeStatus(statusPath, "ready");
    },
  };
};
