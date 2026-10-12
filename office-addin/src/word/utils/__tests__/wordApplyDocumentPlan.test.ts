import { parseWordDocumentPlan } from "@erato/frontend/word-review";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  allowWordWebImport,
  setWordWebImport,
} from "../../../test/mocks/word/applyPolicy";
import {
  examplePlan,
  packageXml,
  paragraph,
  readySnapshot,
  wordSerializationNoise,
} from "../../../test/mocks/word/authoringFixtures";
import {
  applyWordDocumentPlan,
  revertWordDocumentPlan,
} from "../wordApplyDocumentPlan";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import { captureWordAuthoringSnapshot } from "../wordDocumentXml";

import type { WordDocumentPlan } from "@erato/frontend/word-review";

function word(
  ooxml: string,
  transform = (value: string) => value,
  read = (value: string) => value,
) {
  let current = ooxml;
  let pending: string | null = null;
  let failWrite: { code: string; lands: boolean } | undefined;
  let unreadable = false;
  const insert = vi.fn((value: string) => {
    pending = value;
  });
  const document = {
    changeTrackingMode: "Off",
    load: vi.fn(),
    body: {
      getOoxml: () => {
        if (unreadable && insert.mock.calls.length)
          throw new Error("Read unavailable");
        return { value: read(current) };
      },
      insertOoxml: insert,
    },
  };
  const context = {
    document,
    sync: vi.fn(async () => {
      if (pending) {
        if (!failWrite || failWrite.lands) current = transform(pending);
        pending = null;
        if (failWrite)
          throw Object.assign(new Error("private document text"), {
            code: failWrite.code,
            debugInfo: {
              errorLocation: "Body.insertOoxml",
              statement: "private document text",
            },
          });
      }
    }),
  };
  vi.stubGlobal("Word", {
    run: async (callback: (context: Word.RequestContext) => Promise<unknown>) =>
      callback(context as unknown as Word.RequestContext),
  });
  return {
    insert,
    document,
    set: (value: string) => {
      current = value;
    },
    get: () => current,
    /** Word rejects the next write with `code`, after it landed or, with `lands` false, before. */
    fail: (code = "GeneralException", lands = true) => {
      failWrite = { code, lands };
    },
    failRead: () => {
      unreadable = true;
    },
    resume: () => {
      failWrite = undefined;
      unreadable = false;
    },
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("coherent structural execution", () => {
  it("reads, submits, applies, then revises the updated document after recovering the previous turn's token", async () => {
    const original = readySnapshot();
    const host = word(original.ooxml, wordSerializationNoise);
    const session = new WordDocumentReadSession();
    const submit = createWordDocumentSubmissionExecutor(session);
    const firstContext = {
      chatId: "chat-A",
      messageId: "message-A",
      toolCallId: "first-read",
    };
    session.activate(original, firstContext);
    expect(
      (await session.execute({ snapshot: original.token }, firstContext)).ok,
    ).toBe(true);
    const firstPlan = {
      ...examplePlan(original.token),
      readToken: original.readToken!,
    };
    expect(
      (await submit(firstPlan, { ...firstContext, toolCallId: "first-submit" }))
        .ok,
    ).toBe(true);
    const firstApplied = await applyWordDocumentPlan(
      JSON.stringify(firstPlan),
      original,
      firstContext.messageId,
    );
    expect(firstApplied.status).toBe("applied");
    expect(original.used).toBe(true);
    const afterFirst = host.get();
    expect(afterFirst).not.toBe(original.ooxml);

    const next = captureWordAuthoringSnapshot(
      afterFirst,
      original.identity,
      "Off",
    );
    const nextContext = {
      ...firstContext,
      messageId: "message-B",
      toolCallId: "second-read",
    };
    session.activate(next, nextContext);
    expect(
      await session.execute({ snapshot: original.token }, firstContext),
    ).toMatchObject({ ok: false });
    const recovered = await session.execute(
      { snapshot: original.token, cursor: null },
      nextContext,
    );
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) throw new Error(recovered.error);
    const page = recovered.result as {
      snapshot: string;
      readToken: string;
      complete: boolean;
      blocks: { ref: string; text: string }[];
    };
    expect(page.complete).toBe(true);
    expect(page.snapshot).toBe(next.token);
    expect(page.blocks.map((b) => b.text)).toContain("Recommendation");
    expect(page.readToken).not.toBe(firstPlan.readToken);
    expect(await submit(firstPlan, nextContext)).toMatchObject({
      ok: false,
      validationErrors: [{ code: "expired" }],
    });
    const secondPlan: WordDocumentPlan = {
      version: 1,
      snapshot: page.snapshot,
      readToken: page.readToken,
      scope: "body",
      entries: [
        {
          kind: "replace",
          source: [...new Set(page.blocks.map((b) => b.ref))],
          blocks: [
            {
              id: "title",
              type: "heading",
              level: 1,
              text: "Revised recommendation",
            },
            {
              id: "detail",
              type: "paragraph",
              text: "Launch the pilot in October and assess both regions at month end.",
            },
          ],
        },
      ],
      deleted: [],
    };
    expect(
      await submit(
        { ...secondPlan, readToken: firstPlan.readToken },
        nextContext,
      ),
    ).toMatchObject({
      ok: false,
      validationErrors: [{ code: "incomplete-read" }],
    });
    expect(
      (
        await submit(secondPlan, {
          ...nextContext,
          toolCallId: "second-submit",
        })
      ).ok,
    ).toBe(true);
    expect(host.insert).toHaveBeenCalledTimes(1);
    const secondApplied = await applyWordDocumentPlan(
      JSON.stringify(secondPlan),
      next,
      nextContext.messageId,
    );
    expect(secondApplied.status).toBe("applied");
    expect(host.insert).toHaveBeenCalledTimes(2);
    expect(
      captureWordAuthoringSnapshot(
        host.get(),
        original.identity,
        "Off",
      ).blocks.map((b) => b.text),
    ).toEqual([
      "Revised recommendation",
      "Launch the pilot in October and assess both regions at month end.",
    ]);
    expect(
      await session.execute({ snapshot: next.token }, nextContext),
    ).toMatchObject({
      ok: false,
      validationErrors: [{ code: "snapshot-used" }],
    });
    expect(
      (
        await revertWordDocumentPlan(
          secondApplied.before!,
          secondApplied.afterFingerprint!,
        )
      ).status,
    ).toBe("reverted");
    expect(
      (
        await revertWordDocumentPlan(
          firstApplied.before!,
          firstApplied.afterFingerprint!,
        )
      ).status,
    ).toBe("reverted");
  });

  it("applies one validated plan, verifies it and prevents replay", async () => {
    const s = readySnapshot();
    const host = word(s.ooxml);
    const plan = JSON.stringify(examplePlan(s.token));
    const result = await applyWordDocumentPlan(plan, s, "message-A");
    expect(result.status).toBe("applied");
    expect(result.afterFingerprint).toBeTruthy();
    expect(host.insert).toHaveBeenCalledTimes(1);
    expect((await applyWordDocumentPlan(plan, s, "message-A")).status).toBe(
      "blocked",
    );
    expect(host.insert).toHaveBeenCalledTimes(1);
  });
  it("reports each stage in order and stops at a stale preflight", async () => {
    const s = readySnapshot();
    const host = word(s.ooxml);
    const stages: string[] = [];
    const plan = JSON.stringify(examplePlan(s.token));
    expect(
      (
        await applyWordDocumentPlan(plan, s, "message-A", undefined, (stage) =>
          stages.push(stage),
        )
      ).status,
    ).toBe("applied");
    expect(stages).toEqual(["checking", "backup", "writing", "verifying"]);

    const stale = readySnapshot();
    host.set(stale.ooxml.replace("<w:r>", "<w:r><w:rPr><w:b/></w:rPr>"));
    stages.length = 0;
    expect(
      (
        await applyWordDocumentPlan(
          JSON.stringify(examplePlan(stale.token)),
          stale,
          "message-A",
          undefined,
          (stage) => stages.push(stage),
        )
      ).status,
    ).toBe("stale");
    expect(stages).toEqual(["checking", "backup"]);
  });
  it("rejects stale formatting before any mutation", async () => {
    const s = readySnapshot();
    const host = word(s.ooxml.replace("<w:r>", "<w:r><w:rPr><w:b/></w:rPr>"));
    expect(
      (
        await applyWordDocumentPlan(
          JSON.stringify(examplePlan(s.token)),
          s,
          "message-A",
        )
      ).status,
    ).toBe("stale");
    expect(host.insert).not.toHaveBeenCalled();
  });
  it("rejects a different request and incomplete source ownership", async () => {
    const s = readySnapshot();
    const host = word(s.ooxml);
    const plan = examplePlan(s.token);
    expect(
      (await applyWordDocumentPlan(JSON.stringify(plan), s, "message-B"))
        .status,
    ).toBe("blocked");
    plan.deleted = [];
    expect(
      (await applyWordDocumentPlan(JSON.stringify(plan), s, "message-A"))
        .status,
    ).toBe("blocked");
    expect(host.insert).not.toHaveBeenCalled();
  });
  it("does not toggle tracking or write after it was enabled", async () => {
    const s = readySnapshot();
    const host = word(s.ooxml);
    host.document.changeTrackingMode = "TrackAll";
    expect(
      (
        await applyWordDocumentPlan(
          JSON.stringify(examplePlan(s.token)),
          s,
          "message-A",
        )
      ).status,
    ).toBe("stale");
    expect(host.insert).not.toHaveBeenCalled();
    expect(host.document.changeTrackingMode).toBe("TrackAll");
  });
  it("retains an uncertain outcome and cannot blindly retry a write failure", async () => {
    const s = readySnapshot();
    const host = word(s.ooxml);
    host.fail();
    const plan = JSON.stringify(examplePlan(s.token));
    const result = await applyWordDocumentPlan(plan, s, "message-A");
    expect(result.status).toBe("interrupted");
    expect(result.before).toBe(s.ooxml);
    expect(result.afterFingerprint).toBeTruthy();
    expect(result.diagnostic).toEqual({
      stage: "write",
      reason: "host-error",
      officeCode: "GeneralException",
      officeLocation: "Body.insertOoxml",
      details: { error: "Error" },
    });
    expect(JSON.stringify(result)).not.toContain("private document text");
    expect(s.used).toBe(true);
    expect((await applyWordDocumentPlan(plan, s, "message-A")).status).toBe(
      "blocked",
    );
    expect(host.insert).toHaveBeenCalledTimes(1);
  });
  it("restores an unchanged post-state but preserves later user changes", async () => {
    const s = readySnapshot();
    const host = word(s.ooxml);
    const result = await applyWordDocumentPlan(
      JSON.stringify(examplePlan(s.token)),
      s,
      "message-A",
    );
    const after = host.get();
    host.set(after.replace("Recommendation", "User's later heading"));
    expect(
      (await revertWordDocumentPlan(s.ooxml, result.afterFingerprint!)).status,
    ).toBe("stale");
    expect(host.insert).toHaveBeenCalledTimes(1);
    host.set(after);
    expect(
      (await revertWordDocumentPlan(s.ooxml, result.afterFingerprint!)).status,
    ).toBe("reverted");
    expect(host.get()).toBe(s.ooxml);
  });
  it("applies and restores despite metadata changes and identically formatted run splitting", async () => {
    const s = readySnapshot();
    const host = word(wordSerializationNoise(s.ooxml), wordSerializationNoise);
    const before = vi.fn(() => expect(host.insert).not.toHaveBeenCalled());
    const result = await applyWordDocumentPlan(
      JSON.stringify(examplePlan(s.token)),
      s,
      "message-A",
      before,
    );
    expect(result.status).toBe("applied");
    expect(before).toHaveBeenCalledWith(wordSerializationNoise(s.ooxml));
    expect(
      (await revertWordDocumentPlan(result.before!, result.afterFingerprint!))
        .status,
    ).toBe("reverted");
    expect(host.insert).toHaveBeenCalledTimes(2);
  });
  it("retains recovery and a state guard when Word writes a result that differs from the plan", async () => {
    const bodyPackageCounts = {
      parts: 3,
      customXmlItems: 0,
      customProperties: 0,
      abstractNums: 0,
      nums: 0,
      webextensionParts: 0,
    };
    const s = readySnapshot();
    const host = word(s.ooxml, (xml) =>
      xml.replace("Recommendation", "Different heading"),
    );
    const result = await applyWordDocumentPlan(
      JSON.stringify(examplePlan(s.token)),
      s,
      "message-A",
    );
    expect(result.status).toBe("interrupted");
    expect(result.diagnostic).toEqual({
      stage: "verify",
      reason: "output-mismatch",
      details: {
        parts: ["/word/document.xml"],
        verifyTier: "content",
        packages: [
          { label: "expected", ...bodyPackageCounts },
          { label: "actual", ...bodyPackageCounts },
        ],
      },
    });
    expect(JSON.stringify(result.diagnostic)).not.toContain(
      "Different heading",
    );
    expect(result.before).toBe(s.ooxml);
    expect(result.afterFingerprint).toBeTruthy();
    expect(
      (await revertWordDocumentPlan(result.before!, result.afterFingerprint!))
        .status,
    ).toBe("reverted");
    expect(host.insert).toHaveBeenCalledTimes(2);
  });
  it("retains the original before an uncertain write even when no subsequent read is possible", async () => {
    const s = readySnapshot(),
      host = word(s.ooxml),
      backup = vi.fn();
    host.fail();
    host.failRead();
    const result = await applyWordDocumentPlan(
      JSON.stringify(examplePlan(s.token)),
      s,
      "message-A",
      backup,
    );
    expect(result.status).toBe("interrupted");
    expect(result.before).toBe(s.ooxml);
    expect(result.afterFingerprint).toBeUndefined();
    expect(backup).toHaveBeenCalledWith(s.ooxml);
    expect(host.insert).toHaveBeenCalledTimes(1);
  });
  it("expires captures made with the old comparison version without writing", async () => {
    const s = readySnapshot(),
      host = word(s.ooxml);
    s.fingerprint = "old-comparison";
    const result = await applyWordDocumentPlan(
      JSON.stringify(examplePlan(s.token)),
      s,
      "message-A",
    );
    expect(result.diagnostic).toEqual({ stage: "validate", reason: "expired" });
    expect(host.insert).not.toHaveBeenCalled();
  });
});

describe("whole-body writes on Word for the web", () => {
  const context = {
    chatId: "chat-A",
    messageId: "message-A",
    toolCallId: "read",
  };
  beforeEach(() => {
    vi.stubGlobal("Office", {
      context: {
        diagnostics: { host: "Word", platform: "OfficeOnline" },
        requirements: { isSetSupported: () => true },
      },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS;
  });

  it("asks before replacing the body, then applies the same plan once confirmed and reverts it", async () => {
    const s = readySnapshot();
    const host = word(s.ooxml);
    const plan = JSON.stringify(examplePlan(s.token));
    const save = vi.fn();
    expect(await applyWordDocumentPlan(plan, s, "message-A", save)).toEqual({
      status: "blocked",
      diagnostic: {
        stage: "validate",
        reason: "import-needs-confirmation",
        details: { route: "body", fallbackReasons: [] },
      },
    });
    expect(host.insert).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(s.used).toBe(false);

    const applied = await applyWordDocumentPlan(
      plan,
      s,
      "message-A",
      save,
      undefined,
      { importConfirmed: true },
    );
    expect(applied.status).toBe("applied");
    expect(applied.outcome?.route).toBe("body");
    expect(save).toHaveBeenCalledWith(s.ooxml);
    expect(host.insert).toHaveBeenCalledTimes(1);
    expect(
      (await revertWordDocumentPlan(applied.before!, applied.afterFingerprint!))
        .status,
    ).toBe("reverted");
    expect(host.get()).toBe(s.ooxml);
  });

  describe("with a list, whose instances Word for the web renumbers at every body read", () => {
    const CID = "http://schemas.microsoft.com/office/word/2016/wordml/cid";
    const numbering = `<pkg:part pkg:name="/word/numbering.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"><pkg:xmlData><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w16cid="${CID}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1" w16cid:durableId="1000"><w:abstractNumId w:val="0"/></w:num></w:numbering></pkg:xmlData></pkg:part>`;
    let reads = 0;
    const renumber = (value: string) =>
      value.replace(
        /w16cid:durableId="\d+"/g,
        () => `w16cid:durableId="${2000 + ++reads}"`,
      );
    const listed = () =>
      readySnapshot(
        renumber(
          readySnapshot().ooxml.replace(
            "</pkg:package>",
            `${numbering}</pkg:package>`,
          ),
        ),
      );

    it("applies a confirmed body replace, verifies it and reverts it", async () => {
      const s = listed();
      word(s.ooxml, undefined, renumber);
      const applied = await applyWordDocumentPlan(
        JSON.stringify(examplePlan(s.token)),
        s,
        "message-A",
        undefined,
        undefined,
        { importConfirmed: true },
      );
      expect(applied).toMatchObject({
        status: "applied",
        outcome: { route: "body", tier: "strict" },
      });
      expect(
        await revertWordDocumentPlan(
          applied.before!,
          applied.afterFingerprint!,
        ),
      ).toMatchObject({ status: "reverted", outcome: { tier: "strict" } });
    });

    it("still recognizes a NotAllowed refusal that left the body unchanged", async () => {
      const s = listed();
      const host = word(s.ooxml, undefined, renumber);
      host.fail("NotAllowed", false);
      expect(
        await applyWordDocumentPlan(
          JSON.stringify(examplePlan(s.token)),
          s,
          "message-A",
          undefined,
          undefined,
          { importConfirmed: true },
        ),
      ).toMatchObject({
        status: "blocked",
        diagnostic: { stage: "write", reason: "not-allowed" },
      });
    });
  });

  it("refuses a body replace the deployment turned off for the web", async () => {
    setWordWebImport("off");
    const s = readySnapshot();
    const host = word(s.ooxml);
    const result = await applyWordDocumentPlan(
      JSON.stringify(examplePlan(s.token)),
      s,
      "message-A",
      undefined,
      undefined,
      { importConfirmed: true },
    );
    expect(result.diagnostic).toMatchObject({
      stage: "validate",
      reason: "import-disabled",
      details: { route: "body" },
    });
    expect(host.insert).not.toHaveBeenCalled();
    expect(s.used).toBe(false);
  });

  it("refuses a confirmed body replace Word rejects with NotAllowed, unchanged, and never retries it", async () => {
    const s = readySnapshot();
    const host = word(s.ooxml);
    host.fail("NotAllowed", false);
    const confirmed = { importConfirmed: true };
    const plan = JSON.stringify(examplePlan(s.token));
    const result = await applyWordDocumentPlan(
      plan,
      s,
      "message-A",
      undefined,
      undefined,
      confirmed,
    );
    expect(result).toEqual({
      status: "blocked",
      diagnostic: {
        stage: "write",
        reason: "not-allowed",
        officeCode: "NotAllowed",
        officeLocation: "Body.insertOoxml",
        details: { error: "Error" },
      },
    });
    expect(host.get()).toBe(s.ooxml);
    host.resume();
    expect(
      (
        await applyWordDocumentPlan(
          plan,
          s,
          "message-A",
          undefined,
          undefined,
          confirmed,
        )
      ).diagnostic?.reason,
    ).toBe("expired");
    expect(host.insert).toHaveBeenCalledOnce();
  });

  it("keeps a body replace that changed the document before NotAllowed interrupted", async () => {
    const s = readySnapshot();
    const host = word(s.ooxml);
    host.fail("NotAllowed");
    const result = await applyWordDocumentPlan(
      JSON.stringify(examplePlan(s.token)),
      s,
      "message-A",
      undefined,
      undefined,
      { importConfirmed: true },
    );
    expect(result).toMatchObject({
      status: "interrupted",
      before: s.ooxml,
      diagnostic: {
        stage: "write",
        reason: "host-error",
        officeCode: "NotAllowed",
      },
    });
    expect(result.afterFingerprint).not.toBe(s.fingerprint);
  });

  it("leaves a body Revert unretried when Word rejects the restore with NotAllowed", async () => {
    const s = readySnapshot();
    const host = word(s.ooxml);
    const applied = await applyWordDocumentPlan(
      JSON.stringify(examplePlan(s.token)),
      s,
      "message-A",
      undefined,
      undefined,
      { importConfirmed: true },
    );
    expect(applied.status).toBe("applied");
    const after = host.get();
    host.fail("NotAllowed", false);
    expect(
      await revertWordDocumentPlan(applied.before!, applied.afterFingerprint!),
    ).toMatchObject({
      status: "stale",
      diagnostic: {
        stage: "restore",
        reason: "not-allowed",
        officeCode: "NotAllowed",
      },
    });
    expect(host.get()).toBe(after);
  });

  it("never replaces the body for a scoped table-cell edit, even once confirmed", async () => {
    const cell = (text: string) => `<w:tc><w:tcPr/>${paragraph(text)}</w:tc>`;
    const s = readySnapshot(
      packageXml(
        paragraph("Allocation") +
          `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr>${cell("Team")}${cell("Hours")}</w:tr><w:tr>${cell("East")}${cell("18")}</w:tr></w:tbl>` +
          paragraph("After"),
      ),
    );
    const host = word(s.ooxml);
    const session = new WordDocumentReadSession();
    session.activate(s, context);
    const read = await session.execute(
      {
        snapshot: s.token,
        documentIdentity: s.identity,
        table_cell: { header: "hours", rowLabel: "east" },
      },
      context,
    );
    if (!read.ok) throw new Error(read.error);
    const { readToken, target } = read.result as {
      readToken: string;
      target: Record<string, unknown>;
    };
    const submit = createWordDocumentSubmissionExecutor(session);
    const edit = {
      snapshot: s.token,
      readToken,
      table_cell: { ...target, text: "21" },
    };
    expect(
      await submit(edit, { ...context, toolCallId: "submit" }),
    ).toMatchObject({
      ok: false,
      validationErrors: [
        {
          code: "web-needs-whole-document",
          message: expect.stringContaining("because of: no-package."),
        },
      ],
    });
    const restore = allowWordWebImport();
    const submitted = await submit(edit, { ...context, toolCallId: "allowed" });
    restore();
    if (!submitted.ok) throw new Error(submitted.error);
    const plan = parseWordDocumentPlan(
      JSON.stringify((submitted.result as { plan: unknown }).plan),
    )!;
    expect(plan.readToken).toBe(readToken);
    const result = await applyWordDocumentPlan(
      JSON.stringify(plan),
      s,
      "message-A",
      undefined,
      undefined,
      { importConfirmed: true },
    );
    expect(result.diagnostic).toEqual({
      stage: "validate",
      reason: "scoped-needs-in-place",
      details: { route: "body", fallbackReasons: [], readScope: "table-cell" },
    });
    expect(host.insert).not.toHaveBeenCalled();
    expect(s.used).toBe(false);
  });
});
