import { describe, expect, it } from "vitest";

import { findStagedSendLimit } from "../stagedSendLimit";

import type { FileUploadItem } from "@erato/frontend/library";

const limits = { maxBytes: 100, maxFormatted: "100 B", maxFiles: 3 };

function composerFile(filename: string, size?: number): FileUploadItem {
  return {
    id: filename,
    filename,
    download_url: `/files/${filename}`,
    file_contents_unavailable_missing_permissions: false,
    is_sharepoint_file: false,
    file_capability: {
      id: "pdf",
      extensions: ["pdf"],
      mime_types: ["application/pdf"],
      operations: ["extract_text"],
    },
    ...(size === undefined ? {} : { size }),
  };
}

describe("findStagedSendLimit", () => {
  it("passes when every part fits and the count is within the cap", () => {
    expect(
      findStagedSendLimit(
        [{ name: "thread.eml", size: 100 }],
        [composerFile("a.pdf", 10), composerFile("b.pdf")],
        limits,
      ),
    ).toBeNull();
  });

  it("names every oversized part and composer file, per file not summed", () => {
    expect(
      findStagedSendLimit(
        [
          { name: "thread.eml", size: 60 },
          { name: "drop.eml", size: 101 },
        ],
        [composerFile("big.pdf", 150), composerFile("small.pdf", 60)],
        limits,
      ),
    ).toEqual({
      names: ["drop.eml", "big.pdf"],
      formatted: "100 B",
      kind: "size",
    });
  });

  it("reports the count cap once every part fits", () => {
    expect(
      findStagedSendLimit(
        [
          { name: "thread.eml", size: 1 },
          { name: "drop.eml", size: 1 },
        ],
        [composerFile("a.pdf", 1), composerFile("b.pdf", 1)],
        limits,
      ),
    ).toEqual({ names: [], formatted: "3", kind: "count" });
  });

  it("prefers the size verdict over the count verdict", () => {
    expect(
      findStagedSendLimit(
        [{ name: "drop.eml", size: 101 }],
        [composerFile("a.pdf"), composerFile("b.pdf"), composerFile("c.pdf")],
        limits,
      )?.kind,
    ).toBe("size");
  });
});
