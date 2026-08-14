import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  isLibraryBuildInFlight,
  LIBRARY_BUILD_STALE_AFTER_MS,
  libraryBuildStatusFingerprint,
  libraryBuildStatusPath,
  libraryBuildStatusPlugin,
  parseLibraryBuildStatus,
  readLibraryBuildStatus,
  readLibraryBuildStatuses,
} from "./library-build-status";

const createdDirs: string[] = [];

const createDistLibraryDir = () => {
  const distLibraryDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "library-build-status-"),
  );
  createdDirs.push(distLibraryDir);
  return distLibraryDir;
};

afterEach(() => {
  while (createdDirs.length > 0) {
    fs.rmSync(createdDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("parseLibraryBuildStatus", () => {
  it("accepts a well-formed status", () => {
    expect(
      parseLibraryBuildStatus('{"state":"ready","updatedAt":1700000000000}'),
    ).toEqual({ state: "ready", updatedAt: 1700000000000 });
  });

  it.each([
    ["malformed JSON", '{"state":"ready"'],
    ["an unknown state", '{"state":"packing","updatedAt":1}'],
    ["a missing timestamp", '{"state":"ready"}'],
    ["a non-numeric timestamp", '{"state":"ready","updatedAt":"now"}'],
    ["a non-object payload", '"ready"'],
  ])("rejects %s", (_label, contents) => {
    expect(parseLibraryBuildStatus(contents)).toBeNull();
  });

  it("rejects a truncated status file rather than reading it as ready", () => {
    const complete = '{"state":"ready","updatedAt":1700000000000}';
    expect(parseLibraryBuildStatus(complete.slice(0, 20))).toBeNull();
  });
});

describe("isLibraryBuildInFlight", () => {
  const now = 1_700_000_000_000;

  it("is false when no build has reported", () => {
    expect(isLibraryBuildInFlight({}, now)).toBe(false);
  });

  it("is true while any build is building", () => {
    expect(
      isLibraryBuildInFlight(
        {
          library: { state: "ready", updatedAt: now - 10 },
          "component-kit-host": { state: "building", updatedAt: now - 10 },
        },
        now,
      ),
    ).toBe(true);
  });

  it("is false once every build reported a terminal state", () => {
    expect(
      isLibraryBuildInFlight(
        {
          library: { state: "ready", updatedAt: now - 10 },
          "component-kit-host": { state: "failed", updatedAt: now - 10 },
        },
        now,
      ),
    ).toBe(false);
  });

  it("gives up on a build that was killed mid-flight", () => {
    const abandoned = {
      library: {
        state: "building" as const,
        updatedAt: now - LIBRARY_BUILD_STALE_AFTER_MS - 1,
      },
    };
    expect(isLibraryBuildInFlight(abandoned, now)).toBe(false);
  });
});

describe("libraryBuildStatusFingerprint", () => {
  it("changes when a build transitions", () => {
    const building = libraryBuildStatusFingerprint({
      library: { state: "building", updatedAt: 1 },
    });
    const ready = libraryBuildStatusFingerprint({
      library: { state: "ready", updatedAt: 2 },
    });
    expect(building).not.toEqual(ready);
  });

  it("changes when the same state is republished by a later build", () => {
    expect(
      libraryBuildStatusFingerprint({
        library: { state: "ready", updatedAt: 1 },
      }),
    ).not.toEqual(
      libraryBuildStatusFingerprint({
        library: { state: "ready", updatedAt: 2 },
      }),
    );
  });

  it("is stable for unchanged statuses", () => {
    const statuses = {
      library: { state: "ready" as const, updatedAt: 1 },
      "component-kit-host": { state: "ready" as const, updatedAt: 2 },
    };
    expect(libraryBuildStatusFingerprint(statuses)).toEqual(
      libraryBuildStatusFingerprint(statuses),
    );
  });
});

describe("libraryBuildStatusPlugin", () => {
  it("reports building before output is written and ready after", () => {
    const distLibraryDir = createDistLibraryDir();
    const plugin = libraryBuildStatusPlugin({
      distLibraryDir,
      key: "library",
    });

    plugin.buildStart();
    expect(readLibraryBuildStatus(distLibraryDir, "library")?.state).toBe(
      "building",
    );
    expect(
      isLibraryBuildInFlight(
        readLibraryBuildStatuses(distLibraryDir),
        Date.now(),
      ),
    ).toBe(true);

    plugin.buildEnd();
    plugin.writeBundle();
    expect(readLibraryBuildStatus(distLibraryDir, "library")?.state).toBe(
      "ready",
    );
    expect(
      isLibraryBuildInFlight(
        readLibraryBuildStatuses(distLibraryDir),
        Date.now(),
      ),
    ).toBe(false);
  });

  it("reports failed when the build errors, leaving nothing in flight", () => {
    const distLibraryDir = createDistLibraryDir();
    const plugin = libraryBuildStatusPlugin({
      distLibraryDir,
      key: "component-kit-host",
    });

    plugin.buildStart();
    plugin.buildEnd(new Error("transform failed"));

    expect(
      readLibraryBuildStatus(distLibraryDir, "component-kit-host")?.state,
    ).toBe("failed");
    expect(
      isLibraryBuildInFlight(
        readLibraryBuildStatuses(distLibraryDir),
        Date.now(),
      ),
    ).toBe(false);
  });

  it("creates the output directory it reports into", () => {
    const distLibraryDir = path.join(createDistLibraryDir(), "dist-library");
    libraryBuildStatusPlugin({ distLibraryDir, key: "library" }).buildStart();

    expect(
      fs.existsSync(libraryBuildStatusPath(distLibraryDir, "library")),
    ).toBe(true);
  });

  it("keeps each build's status separate", () => {
    const distLibraryDir = createDistLibraryDir();
    libraryBuildStatusPlugin({ distLibraryDir, key: "library" }).writeBundle();
    libraryBuildStatusPlugin({
      distLibraryDir,
      key: "component-kit-host",
    }).buildStart();

    expect(readLibraryBuildStatuses(distLibraryDir)).toMatchObject({
      library: { state: "ready" },
      "component-kit-host": { state: "building" },
    });
  });
});
