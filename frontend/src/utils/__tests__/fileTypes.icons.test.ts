import { describe, it, expect } from "vitest";

import { getFileTypeIcon, FILE_TYPES } from "../fileTypes";

describe("getFileTypeIcon", () => {
  it("should return default icon ID when no theme mapping provided", () => {
    const iconId = getFileTypeIcon("pdf");
    expect(iconId).toBe(FILE_TYPES.pdf.iconId);
    expect(iconId).toBe("MultiplePages");
  });

  it("should return theme icon when mapping provided", () => {
    const iconMappings = {
      pdf: "./icons/custom-pdf.svg",
      image: "CustomImage",
    };

    expect(getFileTypeIcon("pdf", iconMappings)).toBe("./icons/custom-pdf.svg");
    expect(getFileTypeIcon("image", iconMappings)).toBe("CustomImage");
  });

  it("should fallback to default when theme mapping doesnt have the file type", () => {
    const iconMappings = {
      pdf: "./icons/custom-pdf.svg",
    };

    expect(getFileTypeIcon("video", iconMappings)).toBe(
      FILE_TYPES.video.iconId,
    );
  });

  it("should work for all file types", () => {
    expect(getFileTypeIcon("image")).toBe("MediaImage");
    expect(getFileTypeIcon("document")).toBe("Page");
    expect(getFileTypeIcon("code")).toBe("Code");
    expect(getFileTypeIcon("archive")).toBe("Archive");
    expect(getFileTypeIcon("video")).toBe("MediaVideo");
  });
});
