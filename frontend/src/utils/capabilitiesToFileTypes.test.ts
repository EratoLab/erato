import { describe, expect, it } from "vitest";

import {
  capabilitiesToFileTypes,
  getSupportedFileTypes,
  hasSupportedOperations,
} from "./capabilitiesToFileTypes";

import type { FileType } from "./fileTypes";
import type { FileCapability } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

describe("capabilitiesToFileTypes", () => {
  it("should convert capabilities with operations to file types", () => {
    const capabilities: FileCapability[] = [
      {
        id: "pdf",
        extensions: ["pdf"],
        mime_types: ["application/pdf"],
        operations: ["extract_text"],
      },
      {
        id: "word",
        extensions: ["doc", "docx"],
        mime_types: ["application/msword"],
        operations: ["extract_text"],
      },
      {
        id: "image",
        extensions: ["jpg", "png"],
        mime_types: ["image/*"],
        operations: ["analyze_image"],
      },
    ];

    const result = capabilitiesToFileTypes(capabilities);

    expect(result).toContain("pdf");
    expect(result).toContain("document");
    expect(result).toContain("image");
    expect(result).toHaveLength(3);
  });

  it("should exclude capabilities with no operations", () => {
    const capabilities: FileCapability[] = [
      {
        id: "pdf",
        extensions: ["pdf"],
        mime_types: ["application/pdf"],
        operations: ["extract_text"],
      },
      {
        id: "other",
        extensions: ["*"],
        mime_types: ["*/*"],
        operations: [], // No operations
      },
    ];

    const result = capabilitiesToFileTypes(capabilities);

    expect(result).toContain("pdf");
    expect(result).not.toContain("other");
    expect(result).toHaveLength(1);
  });

  it("should handle empty capabilities array", () => {
    const result = capabilitiesToFileTypes([]);

    expect(result).toEqual([]);
  });

  it("should map all known capability IDs correctly", () => {
    const capabilities: FileCapability[] = [
      {
        id: "word",
        extensions: [],
        mime_types: [],
        operations: ["extract_text"],
      },
      {
        id: "pdf",
        extensions: [],
        mime_types: [],
        operations: ["extract_text"],
      },
      {
        id: "excel",
        extensions: [],
        mime_types: [],
        operations: ["extract_text"],
      },
      {
        id: "powerpoint",
        extensions: [],
        mime_types: [],
        operations: ["extract_text"],
      },
      {
        id: "text",
        extensions: [],
        mime_types: [],
        operations: ["extract_text"],
      },
      {
        id: "image",
        extensions: [],
        mime_types: [],
        operations: ["analyze_image"],
      },
    ];

    const result = capabilitiesToFileTypes(capabilities);

    expect(result).toContain("document");
    expect(result).toContain("pdf");
    expect(result).toContain("spreadsheet");
    expect(result).toContain("presentation");
    expect(result).toContain("text");
    expect(result).toContain("image");
    expect(result).toHaveLength(6);
  });

  it("should not have duplicates", () => {
    const capabilities: FileCapability[] = [
      {
        id: "pdf",
        extensions: [],
        mime_types: [],
        operations: ["extract_text"],
      },
      {
        id: "pdf",
        extensions: [],
        mime_types: [],
        operations: ["extract_text"],
      },
    ];

    const result = capabilitiesToFileTypes(capabilities);

    expect(result).toEqual(["pdf"]);
  });
});

describe("hasSupportedOperations", () => {
  it("should return true for capabilities with operations", () => {
    const capability: FileCapability = {
      id: "pdf",
      extensions: ["pdf"],
      mime_types: ["application/pdf"],
      operations: ["extract_text"],
    };

    expect(hasSupportedOperations(capability)).toBe(true);
  });

  it("should return false for capabilities with no operations", () => {
    const capability: FileCapability = {
      id: "other",
      extensions: ["*"],
      mime_types: ["*/*"],
      operations: [],
    };

    expect(hasSupportedOperations(capability)).toBe(false);
  });
});

describe("getSupportedFileTypes", () => {
  it("should return file types from capabilities when available", () => {
    const capabilities: FileCapability[] = [
      {
        id: "pdf",
        extensions: ["pdf"],
        mime_types: ["application/pdf"],
        operations: ["extract_text"],
      },
    ];

    const result = getSupportedFileTypes(capabilities);

    expect(result).toEqual(["pdf"]);
  });

  it("should return empty array when no capabilities and no fallback", () => {
    const result = getSupportedFileTypes([]);

    expect(result).toEqual([]);
  });

  it("should return fallback types when capabilities are empty", () => {
    const fallback: FileType[] = ["pdf", "image"];
    const result = getSupportedFileTypes([], fallback);

    expect(result).toEqual(fallback);
  });

  it("should prefer capabilities over fallback when capabilities exist", () => {
    const capabilities: FileCapability[] = [
      {
        id: "pdf",
        extensions: ["pdf"],
        mime_types: ["application/pdf"],
        operations: ["extract_text"],
      },
    ];
    const fallback: FileType[] = ["image"];

    const result = getSupportedFileTypes(capabilities, fallback);

    expect(result).toEqual(["pdf"]);
    expect(result).not.toContain("image");
  });
});
