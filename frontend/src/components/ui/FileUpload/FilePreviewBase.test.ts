import { describe, expect, it } from "vitest";

import {
  formatFileSize,
  getFilePreviewUrl,
  isImageFileResource,
} from "./FilePreviewBase";

import type { FileResource } from "./FilePreviewBase";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const upload = (values: Partial<FileUploadItem>): FileUploadItem => ({
  id: "file",
  filename: "opaque-id",
  file_contents_unavailable_missing_permissions: false,
  is_sharepoint_file: false,
  download_url: "/original",
  file_capability: {
    id: "other",
    operations: [],
    extensions: [],
    mime_types: [],
  },
  ...values,
});

describe("attachment resource metadata", () => {
  it("prefers preview bytes, falls back to download, and has no URL before upload", () => {
    expect(getFilePreviewUrl(upload({ preview_url: "/preview" }))).toBe(
      "/preview",
    );
    expect(getFilePreviewUrl(upload({}))).toBe("/original");
    expect(
      getFilePreviewUrl({ id: "local", filename: "photo.png" }),
    ).toBeUndefined();
    expect(getFilePreviewUrl(new File([""], "photo.png"))).toBeUndefined();
  });

  it.each<FileResource>([
    { id: "local", filename: "PHOTO.PNG" },
    upload({
      file_capability: {
        id: "image",
        operations: [],
        extensions: [],
        mime_types: [],
      },
    }),
    upload({
      file_capability: {
        id: "custom",
        operations: ["analyze_image"],
        extensions: [],
        mime_types: [],
      },
    }),
  ])(
    "identifies local extensions and server image capabilities",
    (resource) => {
      expect(isImageFileResource(resource)).toBe(true);
    },
  );

  it("does not treat an ordinary document's preview URL as an image", () => {
    expect(
      isImageFileResource(
        upload({ filename: "report.pdf", preview_url: "/preview" }),
      ),
    ).toBe(false);
  });
});

describe("formatFileSize", () => {
  it.each([
    [512, "512 B"],
    [1023, "1023 B"],
    [80_000, "78 KB"],
    [1_258_291, "1.2 MB"],
    [5_368_709_120, "5120 MB"],
  ])("formats %d bytes as %s in the active English locale", (bytes, label) => {
    expect(formatFileSize(bytes)).toBe(label);
  });

  it("takes the German decimal mark and keeps the unit labels", () => {
    expect(formatFileSize(1_258_291, "de")).toBe("1,2 MB");
    expect(formatFileSize(34_816, "de")).toBe("34 KB");
    expect(formatFileSize(5_368_709_120, "de")).toBe("5120 MB");
  });
});
