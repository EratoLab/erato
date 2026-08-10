import { describe, it, expect } from "vitest";

import { validateFileSizes } from "../validateFileSizes";

const MiB = 1024 * 1024;
const LIMIT = 15 * MiB; // non-default limit used throughout these tests

function makeFile(name: string, size: number): File {
  // File constructor: content (Blob parts), name, options
  return new File(["x".repeat(0)], name, { type: "text/plain" }) as File & {
    size: number;
  };
}

// Real File objects have immutable `.size` (set from content). Override it for
// tests where precise sizes matter.
function makeFileWithSize(name: string, size: number): File {
  const blob = new Blob([new Uint8Array(size)]);
  return new File([blob], name, { type: "application/octet-stream" });
}

describe("validateFileSizes", () => {
  describe("single file at or around the limit", () => {
    it("accepts a file one byte below the limit", () => {
      const file = makeFileWithSize("small.bin", LIMIT - 1);
      expect(validateFileSizes([file], LIMIT)).toEqual({ valid: true });
    });

    it("accepts a file exactly at the limit", () => {
      const file = makeFileWithSize("exact.bin", LIMIT);
      expect(validateFileSizes([file], LIMIT)).toEqual({ valid: true });
    });

    it("rejects a file one byte above the limit", () => {
      const file = makeFileWithSize("big.bin", LIMIT + 1);
      const result = validateFileSizes([file], LIMIT);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.oversizedFiles).toHaveLength(1);
        expect(result.oversizedFiles[0].name).toBe("big.bin");
      }
    });
  });

  describe("batch validation", () => {
    it("returns valid when all files are within the limit", () => {
      const files = [
        makeFileWithSize("a.bin", LIMIT - 100),
        makeFileWithSize("b.bin", LIMIT),
        makeFileWithSize("c.bin", 0),
      ];
      expect(validateFileSizes(files, LIMIT)).toEqual({ valid: true });
    });

    it("rejects the batch when one file is oversized", () => {
      const files = [
        makeFileWithSize("ok.bin", LIMIT),
        makeFileWithSize("toobig.bin", LIMIT + 1),
      ];
      const result = validateFileSizes(files, LIMIT);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.oversizedFiles).toHaveLength(1);
        expect(result.oversizedFiles[0].name).toBe("toobig.bin");
      }
    });

    it("returns all oversized files when multiple exceed the limit", () => {
      const files = [
        makeFileWithSize("a.bin", LIMIT + 1),
        makeFileWithSize("b.bin", LIMIT),
        makeFileWithSize("c.bin", LIMIT + 100),
      ];
      const result = validateFileSizes(files, LIMIT);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.oversizedFiles).toHaveLength(2);
        const names = result.oversizedFiles.map((f) => f.name);
        expect(names).toContain("a.bin");
        expect(names).toContain("c.bin");
      }
    });

    it("returns valid for an empty file array", () => {
      expect(validateFileSizes([], LIMIT)).toEqual({ valid: true });
    });
  });

  describe("oversized file metadata", () => {
    it("exposes the original File object so callers can include the filename in errors", () => {
      const file = makeFileWithSize("important.pdf", LIMIT + 42);
      const result = validateFileSizes([file], LIMIT);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.oversizedFiles[0]).toBe(file);
      }
    });
  });
});
