import { describe, it, expect } from "vitest";

import { makeFileWithSize } from "@/test/fileFixtures";

import {
  oversizedRejectionNames,
  rejectionNames,
  validateFileSizes,
} from "../validateFileSizes";

const MiB = 1024 * 1024;
const LIMIT = 15 * MiB; // non-default limit used throughout these tests

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

describe("rejectionNames", () => {
  const rejections = [
    { file: { name: "wrong.exe" }, errors: [{ code: "file-invalid-type" }] },
    { file: { name: "big.pdf" }, errors: [{ code: "file-too-large" }] },
    {
      file: { name: "both.exe" },
      errors: [{ code: "file-invalid-type" }, { code: "file-too-large" }],
    },
    { file: { name: "fine.pdf" }, errors: [] },
  ];

  it("names the files whose rejection carries the code", () => {
    expect(rejectionNames(rejections, "file-invalid-type")).toEqual([
      "wrong.exe",
      "both.exe",
    ]);
    expect(rejectionNames(rejections, "file-too-large")).toEqual([
      "big.pdf",
      "both.exe",
    ]);
  });

  it("returns nothing for a code no rejection carries", () => {
    expect(rejectionNames(rejections, "too-many-files")).toEqual([]);
  });
});

describe("oversizedRejectionNames", () => {
  it("names size-only rejections and leaves out a file that also fails the type check", () => {
    expect(
      oversizedRejectionNames([
        { file: { name: "big.pdf" }, errors: [{ code: "file-too-large" }] },
        {
          file: { name: "both.exe" },
          errors: [{ code: "file-invalid-type" }, { code: "file-too-large" }],
        },
        {
          file: { name: "wrong.exe" },
          errors: [{ code: "file-invalid-type" }],
        },
      ]),
    ).toEqual(["big.pdf"]);
  });
});
