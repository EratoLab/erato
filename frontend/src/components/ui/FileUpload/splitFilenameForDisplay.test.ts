import { describe, expect, it } from "vitest";

import { splitFilenameForDisplay } from "./FilePreviewBase";

describe("splitFilenameForDisplay", () => {
  it("splits a real file extension off the stem", () => {
    expect(splitFilenameForDisplay("report.pdf")).toEqual({
      stem: "report",
      extension: ".pdf",
    });
  });

  it("splits only the final extension for multi-dot names", () => {
    expect(splitFilenameForDisplay("archive.tar.gz")).toEqual({
      stem: "archive.tar",
      extension: ".gz",
    });
  });

  it("treats an uppercase extension as an extension", () => {
    expect(splitFilenameForDisplay("Scan.PDF")).toEqual({
      stem: "Scan",
      extension: ".PDF",
    });
  });

  it("does NOT split a label whose tail after a dot has spaces (reply-context bug)", () => {
    const subject =
      "Kickoff Kundenportal 2.0 – Lastenheft im Anhang — Daniel Person";
    expect(splitFilenameForDisplay(subject)).toEqual({
      stem: subject,
      extension: "",
    });
  });

  it("does not split when the suffix is too long / not alphanumeric", () => {
    const label = "release.notes_for_the_whole_quarter";
    expect(splitFilenameForDisplay(label)).toEqual({
      stem: label,
      extension: "",
    });
  });

  it("leaves a name without a dot untouched", () => {
    expect(splitFilenameForDisplay("no extension here")).toEqual({
      stem: "no extension here",
      extension: "",
    });
  });

  it("does not treat a leading-dot dotfile as all-extension", () => {
    expect(splitFilenameForDisplay(".gitignore")).toEqual({
      stem: ".gitignore",
      extension: "",
    });
  });

  it("ignores a trailing dot", () => {
    expect(splitFilenameForDisplay("weird.")).toEqual({
      stem: "weird.",
      extension: "",
    });
  });
});
