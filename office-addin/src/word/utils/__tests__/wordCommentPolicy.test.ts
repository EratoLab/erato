import { afterEach, describe, expect, it } from "vitest";

import {
  noteWordCommentAssistantAuthorOff,
  noteWordCommentHostError,
  resetWordCommentSession,
  wordCommentAssistantAuthorAvailable,
  wordCommentAssistantAuthorName,
  wordCommentDeploymentSettings,
  wordCommentRowCap,
  wordCommentSessionReason,
  wordCommentWriteMode,
} from "../wordCommentPolicy";

const officeError = (code: string) =>
  Object.assign(new Error(code), { code, name: "RichApi.Error" });

afterEach(() => {
  resetWordCommentSession();
  delete window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS;
});

describe("the host × action matrix (O-15)", () => {
  it("posts on every probed host and copies on an unknown one", () => {
    for (const host of ["PC", "Mac", "OfficeOnline"] as const)
      for (const cls of ["add", "respond", "modify"] as const)
        expect(wordCommentWriteMode(cls, host)).toBe("post");
    expect(wordCommentWriteMode("add", "unknown")).toBe("copy");
  });

  it("lets the deployment switch a class to copy", () => {
    window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS = {
      comment_writes: { modify: "copy" },
    };
    expect(wordCommentWriteMode("modify", "PC")).toBe("copy");
    expect(wordCommentWriteMode("add", "PC")).toBe("post");
  });

  it("switches a class to copy for the session on the first host refusal", () => {
    expect(noteWordCommentHostError("respond", officeError("NotAllowed"))).toBe(
      true,
    );
    expect(wordCommentWriteMode("respond", "OfficeOnline")).toBe("copy");
    expect(wordCommentWriteMode("add", "OfficeOnline")).toBe("post");
    expect(wordCommentSessionReason("respond")).toBe("NotAllowed");
  });

  it("switches every class on AccessDenied, which read-only protection gives", () => {
    noteWordCommentHostError("add", officeError("AccessDenied"));
    for (const cls of ["add", "respond", "modify"] as const)
      expect(wordCommentWriteMode(cls, "PC")).toBe("copy");
  });

  it("ignores errors that say nothing about the host", () => {
    expect(
      noteWordCommentHostError("add", officeError("GeneralException")),
    ).toBe(false);
    expect(noteWordCommentHostError("add", new Error("timeout"))).toBe(false);
    expect(wordCommentWriteMode("add", "PC")).toBe("post");
  });
});

describe("AI-author availability (O-28)", () => {
  it("is on for PC and Mac, off on the web", () => {
    expect(wordCommentAssistantAuthorAvailable("PC")).toBe(true);
    expect(wordCommentAssistantAuthorAvailable("Mac")).toBe(true);
    expect(wordCommentAssistantAuthorAvailable("OfficeOnline")).toBe(false);
  });

  it("goes off with the deployment's switch, the session's, or adds in copy mode", () => {
    window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS = {
      comment_writes: { assistant_author: false },
    };
    expect(wordCommentAssistantAuthorAvailable("PC")).toBe(false);
    window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS = {
      comment_writes: { add: "copy" },
    };
    expect(wordCommentAssistantAuthorAvailable("PC")).toBe(false);
    delete window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS;
    noteWordCommentAssistantAuthorOff();
    expect(wordCommentAssistantAuthorAvailable("PC")).toBe(false);
  });

  it("names the author from the template and the principal, within 120 characters", () => {
    expect(
      wordCommentAssistantAuthorName(
        "Erato (AI) for {user}",
        " Daniel  Fiebig ",
      ),
    ).toBe("Erato (AI) for Daniel Fiebig");
    expect(
      wordCommentAssistantAuthorName("Erato (AI) for {user}", ""),
    ).toBeNull();
    expect(
      wordCommentAssistantAuthorName("Erato (AI) for {user}", null),
    ).toBeNull();
    expect(
      wordCommentAssistantAuthorName("Erato (AI) for {user}", "x".repeat(110)),
    ).toBeNull();
  });
});

describe("deployment comment settings", () => {
  it("defaults to the Erato AI label, user mode and the English template", () => {
    expect(wordCommentDeploymentSettings()).toEqual({
      label: "Erato AI:",
      authorSeed: "user",
      authorEnforced: false,
      assistantAuthor: "Erato (AI) for {user}",
    });
  });

  it("keeps an empty label and refuses a template without exactly one {user}", () => {
    window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS = {
      comment_label: "  ",
      comment_author: "assistant",
      comment_author_enforced: true,
      comment_assistant_author: "Erato (KI)",
    };
    expect(wordCommentDeploymentSettings()).toEqual({
      label: "",
      authorSeed: "assistant",
      authorEnforced: true,
      assistantAuthor: "Erato (AI) for {user}",
    });
    window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS = {
      comment_assistant_author: "Erato (KI) für {user}",
    };
    expect(wordCommentDeploymentSettings().assistantAuthor).toBe(
      "Erato (KI) für {user}",
    );
  });

  it("caps rows per class at the configured number, never above 50", () => {
    expect(wordCommentRowCap("add")).toBe(50);
    expect(wordCommentRowCap("respond")).toBe(20);
    window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS = {
      comment_writes: { max_rows: { add: 10, respond: 500, modify: 0 } },
    };
    expect(wordCommentRowCap("add")).toBe(10);
    expect(wordCommentRowCap("respond")).toBe(20);
    expect(wordCommentRowCap("modify")).toBe(20);
  });
});
