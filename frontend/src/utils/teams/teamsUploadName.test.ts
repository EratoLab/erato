import { describe, expect, it } from "vitest";

import { teamsUploadDisplayName } from "./teamsUploadName";

describe("teamsUploadDisplayName", () => {
  it("recovers the readable tail of a minted file upload", () => {
    expect(
      teamsUploadDisplayName("teams-file-5d4d89ed-multipage-test.pdf"),
    ).toBe("multipage-test.pdf");
    expect(
      teamsUploadDisplayName("teams-file-d72e2945-big-file-20mb.pdf"),
    ).toBe("big-file-20mb.pdf");
  });

  it("keeps the slug's substitutions, which are not reversible", () => {
    // `Q3 report.pdf` was slugged on the way in; the exact name lives in the
    // transcript's index, and this is only the fallback for a bare upload.
    expect(teamsUploadDisplayName("teams-file-abcd1234-Q3_report.pdf")).toBe(
      "Q3_report.pdf",
    );
  });

  it("says nothing for a pasted image, which never had a name", () => {
    expect(teamsUploadDisplayName("teams-img-0123456789abcdef.png")).toBeNull();
  });

  it("leaves anything it did not mint alone", () => {
    for (const name of [
      "holiday.pdf",
      "teams-chats-2.md",
      // Near-misses: the hash segment is what identifies a minted name.
      "teams-file-report.pdf",
      "teams-file-XYZ12345-report.pdf",
      "teams-file-5d4d89ed-",
      "notes-teams-file-5d4d89ed-report.pdf",
    ]) {
      expect(teamsUploadDisplayName(name)).toBeNull();
    }
  });
});
