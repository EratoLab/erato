import { describe, it, expect } from "vitest";

import {
  hasSupportedOperations,
  getFileExtension,
  findCapabilityByExtension,
  validateFiles,
} from "./fileCapabilities";

import type { FileCapability } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

describe("fileCapabilities", () => {
  const mockCapabilities: FileCapability[] = [
    {
      id: "pdf",
      extensions: ["pdf"],
      mime_types: ["application/pdf"],
      operations: ["extract_text"],
    },
    {
      id: "word",
      extensions: ["doc", "docx"],
      mime_types: [
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      operations: ["extract_text"],
    },
    {
      id: "image",
      extensions: ["jpg", "jpeg", "png", "gif"],
      mime_types: ["image/*"],
      operations: ["analyze_image"],
    },
    {
      id: "other",
      extensions: ["*"],
      mime_types: ["*/*"],
      operations: [],
    },
  ];

  describe("hasSupportedOperations", () => {
    it("should return true for capability with operations", () => {
      const capability: FileCapability = {
        id: "pdf",
        extensions: ["pdf"],
        mime_types: ["application/pdf"],
        operations: ["extract_text"],
      };
      expect(hasSupportedOperations(capability)).toBe(true);
    });

    it("should return false for capability without operations", () => {
      const capability: FileCapability = {
        id: "other",
        extensions: ["*"],
        mime_types: ["*/*"],
        operations: [],
      };
      expect(hasSupportedOperations(capability)).toBe(false);
    });
  });

  describe("getFileExtension", () => {
    it("should extract extension from simple filename", () => {
      expect(getFileExtension("document.pdf")).toBe("pdf");
    });

    it("should extract extension from filename with multiple dots", () => {
      expect(getFileExtension("my.document.file.docx")).toBe("docx");
    });

    it("should return lowercase extension", () => {
      expect(getFileExtension("Document.PDF")).toBe("pdf");
    });

    it("should return null for filename without extension", () => {
      expect(getFileExtension("README")).toBe(null);
    });

    it("should return null for empty filename", () => {
      expect(getFileExtension("")).toBe(null);
    });

    it("should handle filenames with spaces", () => {
      expect(getFileExtension("my document.pdf")).toBe("pdf");
    });
  });

  describe("findCapabilityByExtension", () => {
    it("should find capability for matching extension", () => {
      const capability = findCapabilityByExtension(
        "document.pdf",
        mockCapabilities,
      );
      expect(capability).toBeDefined();
      expect(capability?.id).toBe("pdf");
    });

    it("should find capability for case-insensitive extension", () => {
      const capability = findCapabilityByExtension(
        "Document.PDF",
        mockCapabilities,
      );
      expect(capability).toBeDefined();
      expect(capability?.id).toBe("pdf");
    });

    it("should find capability for multiple possible extensions", () => {
      const capability = findCapabilityByExtension(
        "report.docx",
        mockCapabilities,
      );
      expect(capability).toBeDefined();
      expect(capability?.id).toBe("word");
    });

    it("should find wildcard capability for unknown extension", () => {
      const capability = findCapabilityByExtension(
        "archive.zip",
        mockCapabilities,
      );
      expect(capability).toBeDefined();
      expect(capability?.id).toBe("other");
    });

    it("should return null for filename without extension", () => {
      const capability = findCapabilityByExtension("README", mockCapabilities);
      expect(capability).toBe(null);
    });

    it("should prefer exact match over wildcard", () => {
      const capability = findCapabilityByExtension(
        "image.jpg",
        mockCapabilities,
      );
      expect(capability).toBeDefined();
      expect(capability?.id).toBe("image");
    });
  });

  describe("validateFiles", () => {
    it("should classify all files as valid when they have operations", () => {
      const files = [
        new File(["content"], "document.pdf", { type: "application/pdf" }),
        new File(["content"], "report.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      ];

      const { valid, invalid } = validateFiles(files, mockCapabilities);

      expect(valid.length).toBe(2);
      expect(invalid.length).toBe(0);
    });

    it("should classify files without operations as invalid", () => {
      const files = [
        new File(["content"], "archive.zip", { type: "application/zip" }),
        new File(["content"], "program.exe", {
          type: "application/x-msdownload",
        }),
      ];

      const { valid, invalid } = validateFiles(files, mockCapabilities);

      expect(valid.length).toBe(0);
      expect(invalid.length).toBe(2);
    });

    it("should classify mixed files correctly", () => {
      const files = [
        new File(["content"], "document.pdf", { type: "application/pdf" }),
        new File(["content"], "archive.zip", { type: "application/zip" }),
        new File(["content"], "image.png", { type: "image/png" }),
      ];

      const { valid, invalid } = validateFiles(files, mockCapabilities);

      expect(valid.length).toBe(2);
      expect(invalid.length).toBe(1);
      expect(valid[0].name).toBe("document.pdf");
      expect(valid[1].name).toBe("image.png");
      expect(invalid[0].name).toBe("archive.zip");
    });

    it("should handle empty file list", () => {
      const files: File[] = [];

      const { valid, invalid } = validateFiles(files, mockCapabilities);

      expect(valid.length).toBe(0);
      expect(invalid.length).toBe(0);
    });

    it("should classify file without extension as invalid", () => {
      const files = [new File(["content"], "README", { type: "text/plain" })];

      const { valid, invalid } = validateFiles(files, mockCapabilities);

      expect(valid.length).toBe(0);
      expect(invalid.length).toBe(1);
    });

    it("should handle empty capabilities list", () => {
      const files = [
        new File(["content"], "document.pdf", { type: "application/pdf" }),
      ];

      const { valid, invalid } = validateFiles(files, []);

      expect(valid.length).toBe(0);
      expect(invalid.length).toBe(1);
    });
  });
});
