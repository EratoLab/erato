import { afterEach, describe, expect, it, vi } from "vitest";

import {
  examplePlan,
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

import type { WordDocumentPlan } from "../wordDocumentPlan";

function word(ooxml: string, transform = (value: string) => value) {
  let current = ooxml;
  let pending: string | null = null;
  let failWrite = false;
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
        return { value: current };
      },
      insertOoxml: insert,
    },
  };
  const context = {
    document,
    sync: vi.fn(async () => {
      if (pending) {
        current = transform(pending);
        pending = null;
        if (failWrite)
          throw Object.assign(new Error("private document text"), {
            code: "GeneralException",
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
    fail: () => {
      failWrite = true;
    },
    failRead: () => {
      unreadable = true;
    },
    resume: () => {
      failWrite = false;
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
    });
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
