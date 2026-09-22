import { describe, expect, it } from "vitest";

import {
  packageXml,
  paragraph,
} from "../../../test/mocks/word/authoringFixtures";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { captureWordAuthoringSnapshot } from "../wordDocumentXml";

import type { ClientToolExecutionResult } from "@erato/frontend/library";

const context = {
  toolCallId: "call-A",
  messageId: "message-A",
  chatId: "chat-A",
};
interface Page {
  snapshot: string;
  snapshotRecovery?: { requestedSnapshot: string; restarted: boolean };
  blocks: { ref: string; text: string; part: number; parts: number }[];
  nextCursor: string | null;
  complete: boolean;
  readToken?: string;
  blocksRead: number;
}
const page = (result: ClientToolExecutionResult): Page => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.result as Page;
};
describe("bounded body read session", () => {
  it.each([undefined, null, ""])(
    "recovers a stale first-page token with cursor %s inside the bound request",
    async (cursor) => {
      const s = captureWordAuthoringSnapshot(
        packageXml(paragraph("Updated document")),
        "doc",
        "Off",
      );
      const session = new WordDocumentReadSession();
      session.activate(s, context);
      const result = page(
        await session.execute({ snapshot: "prior-turn", cursor }, context),
      );
      expect(result.snapshot).toBe(s.token);
      expect(result.snapshotRecovery).toEqual({
        requestedSnapshot: "prior-turn",
        restarted: true,
      });
      expect(result.blocks.map((b) => b.text)).toEqual(["Updated document"]);
      expect(result.readToken).toBe(s.readToken);
      expect(s.used).toBe(false);
      expect(
        page(await session.execute({ snapshot: s.token }, context)),
      ).not.toHaveProperty("snapshotRecovery");
    },
  );

  it("does not let the first caller, a delayed turn, a child chat or a reaction claim a capture", async () => {
    const s = captureWordAuthoringSnapshot(
      packageXml(paragraph("Current private content")),
      "doc",
      "Off",
    );
    const session = new WordDocumentReadSession();
    session.activate(s);
    const call = (owner: typeof context) =>
      session.execute({ snapshot: s.token }, owner);
    expect(await call(context)).toMatchObject({
      ok: false,
      validationErrors: [{ code: "wrong-request" }],
    });
    expect(session.bindRequest(s.token, context)).toBe(true);
    for (const wrong of [
      { ...context, messageId: "previous-message" },
      { ...context, chatId: "child-chat" },
      { ...context, messageId: "task-reaction" },
    ]) {
      expect(session.bindRequest(s.token, wrong)).toBe(false);
      const failure = await call(wrong);
      expect(failure).toMatchObject({
        ok: false,
        validationErrors: [{ code: "wrong-request" }],
      });
      expect(JSON.stringify(failure)).not.toContain(s.token);
      expect(JSON.stringify(failure)).not.toContain("Current private content");
    }
    expect(s.read.size).toBe(0);
    expect(s.readToken).toBeUndefined();
    expect((await call(context)).ok).toBe(true);
  });

  it("never continues with a cursor from a previous snapshot, and preserves paging across task pauses", async () => {
    const source = packageXml(
      paragraph("Long document content. ".repeat(2000)),
    );
    const session = new WordDocumentReadSession();
    const old = captureWordAuthoringSnapshot(source, "doc", "Off");
    session.activate(old, context);
    const oldPage = page(
      await session.execute({ snapshot: old.token }, context),
    );
    expect(oldPage.nextCursor).toBeTruthy();
    const next = captureWordAuthoringSnapshot(
      source.replace("Long", "Fresh"),
      "doc",
      "Off",
    );
    const nextContext = { ...context, messageId: "message-B" };
    session.activate(next, nextContext);
    const stale = await session.execute(
      { snapshot: old.token, cursor: oldPage.nextCursor },
      nextContext,
    );
    expect(stale).toMatchObject({
      ok: false,
      validationErrors: [{ path: "/snapshot", code: "snapshot-mismatch" }],
    });
    expect(JSON.stringify(stale)).toContain(next.token);
    expect(next.read.size).toBe(0);
    expect(next.readToken).toBeUndefined();
    expect(
      await session.execute(
        { snapshot: next.token, cursor: oldPage.nextCursor },
        nextContext,
      ),
    ).toMatchObject({
      ok: false,
      validationErrors: [{ path: "/cursor", code: "read-cursor" }],
    });
    let result = page(
      await session.execute({ snapshot: old.token, cursor: null }, nextContext),
    );
    expect(result.complete).toBe(false);
    expect(result.readToken).toBeUndefined();
    const returned = result.blocks.map((b) => b.text);
    let step = 0;
    while (result.nextCursor) {
      const input = { snapshot: next.token, cursor: result.nextCursor };
      const stepContext = {
        ...nextContext,
        toolCallId: `resumed-step-${step++}`,
      };
      const response = await session.execute(input, stepContext);
      expect(await session.execute(input, stepContext)).toEqual(response);
      result = page(response);
      returned.push(...result.blocks.map((b) => b.text));
    }
    expect(returned.join("")).toBe(next.blocks[0].text);
    expect(result.complete).toBe(true);
    expect(result.readToken).toBe(next.readToken);
    expect(next.ownerMessageId).toBe(nextContext.messageId);
  });

  it.each(["used", "revoked"] as const)(
    "requires a fresh capture after a snapshot is %s",
    async (state) => {
      const s = captureWordAuthoringSnapshot(
        packageXml(paragraph("A")),
        "doc",
        "Off",
      );
      const session = new WordDocumentReadSession();
      session.activate(s, context);
      s[state] = true;
      expect(
        await session.execute(
          { snapshot: "prior-turn", cursor: null },
          context,
        ),
      ).toMatchObject({
        ok: false,
        validationErrors: [{ code: `snapshot-${state}` }],
      });
      expect(s.read.size).toBe(0);
    },
  );

  it.each([
    null,
    [],
    {},
    { snapshot: null },
    { snapshot: 42 },
    { snapshot: "" },
    { snapshot: "x".repeat(129) },
    { snapshot: "old", cursor: 42 },
    { snapshot: "old", extra: true },
  ])(
    "keeps malformed read arguments distinct from stale tokens: %j",
    async (input) => {
      const s = captureWordAuthoringSnapshot(
        packageXml(paragraph("A")),
        "doc",
        "Off",
      );
      const session = new WordDocumentReadSession();
      session.activate(s, context);
      expect(await session.execute(input, context)).toMatchObject({
        ok: false,
        validationErrors: [{ code: "read-arguments" }],
      });
      expect(s.read.size).toBe(0);
    },
  );

  it("covers all 320 paragraphs past the old head window in fewer than 13 calls", async () => {
    const texts = Array.from(
      { length: 320 },
      (_, i) => `Record ${i}. ${"Important facts remain visible. ".repeat(9)}`,
    );
    expect(new TextEncoder().encode(texts.join("")).length).toBeGreaterThan(
      61440,
    );
    const s = captureWordAuthoringSnapshot(
      packageXml(texts.map(paragraph).join("")),
      "doc",
      "Off",
    );
    const session = new WordDocumentReadSession();
    session.activate(s, context);
    let cursor: string | null = null;
    let calls = 0;
    const returned = new Map<string, string>();
    let result: Page;
    do {
      result = page(
        await session.execute({ snapshot: s.token, cursor }, context),
      );
      calls++;
      result.blocks.forEach((b) =>
        returned.set(b.ref, (returned.get(b.ref) ?? "") + b.text),
      );
      cursor = result.nextCursor;
    } while (cursor);
    expect(calls).toBeLessThanOrEqual(12);
    expect(calls).toBeGreaterThan(1);
    expect(result.complete).toBe(true);
    expect(result.readToken).toBe(s.readToken);
    expect(s.read.size).toBe(320);
    expect([...returned.values()]).toEqual(texts);
  });
  it("splits a large Unicode paragraph without counting a prefix as complete", async () => {
    const text = "🧩漢字 ".repeat(7000);
    const s = captureWordAuthoringSnapshot(
      packageXml(paragraph(text)),
      "doc",
      "Off",
    );
    const session = new WordDocumentReadSession();
    session.activate(s, context);
    let first = page(await session.execute({ snapshot: s.token }, context));
    expect(first.complete).toBe(false);
    expect(first.blocksRead).toBe(0);
    expect(first.readToken).toBeUndefined();
    let combined = first.blocks.map((b) => b.text).join("");
    while (first.nextCursor) {
      first = page(
        await session.execute(
          { snapshot: s.token, cursor: first.nextCursor },
          context,
        ),
      );
      combined += first.blocks.map((b) => b.text).join("");
    }
    expect(combined).toBe(text);
    expect(s.read.size).toBe(1);
  });
  it("replays the same page and proof without duplicate coverage", async () => {
    const s = captureWordAuthoringSnapshot(
      packageXml(paragraph("A")),
      "doc",
      "Off",
    );
    const session = new WordDocumentReadSession();
    session.activate(s, context);
    const first = await session.execute({ snapshot: s.token }, context);
    expect(await session.execute({ snapshot: s.token }, context)).toEqual(
      first,
    );
    expect(s.read.size).toBe(1);
  });
  it("rejects wrong chat, request, cursor and cancellation", async () => {
    const s = captureWordAuthoringSnapshot(
      packageXml(paragraph("A")),
      "doc",
      "Off",
    );
    const session = new WordDocumentReadSession();
    session.activate(s, context);
    await session.execute({ snapshot: s.token }, context);
    expect(
      (
        await session.execute(
          { snapshot: s.token },
          { ...context, chatId: "chat-B" },
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await session.execute(
          { snapshot: s.token },
          { ...context, messageId: "message-B" },
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await session.execute(
          { snapshot: s.token, cursor: "invented" },
          context,
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await session.execute(
          { snapshot: s.token },
          { ...context, signal: AbortSignal.abort() },
        )
      ).ok,
    ).toBe(false);
    session.clear();
    expect(s.revoked).toBe(true);
    expect((await session.execute({ snapshot: s.token }, context)).ok).toBe(
      false,
    );
  });
});
