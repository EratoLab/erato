import { describe, expect, it } from "vitest";

import {
  body,
  chapter,
  heading,
  okResult,
  openReadSession,
  readContext,
  sectionSnapshot,
  table,
  untouchedWriteState,
  writeState,
} from "../../../test/mocks/word/sectionFixtures";

import type {
  ClientToolCallContext,
  ClientToolExecutionResult,
  ClientToolHostGrant,
} from "@erato/frontend/library";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

const snapshotOf = () =>
  sectionSnapshot([
    body("Master Services Agreement"),
    ...chapter(1, 8),
    heading(1, "Fees"),
    body("Payment is due net 30."),
    table([
      ["Team", "Hours"],
      ["West", "21"],
    ]),
  ]);

const task = {
  toolCallId: "task-call",
  messageId: "task-message",
  chatId: "task-chat",
};

const grantOf = (snapshot: WordAuthoringSnapshot): ClientToolHostGrant => ({
  ownerChatId: readContext.chatId,
  ownerMessageId: readContext.messageId,
  requestingChatId: task.chatId,
  requestingMessageId: task.messageId,
  contextRef: snapshot.token,
});

function open() {
  const snapshot = snapshotOf();
  const opened = openReadSession(snapshot);
  const child = (
    input: unknown,
    grant: ClientToolHostGrant = grantOf(snapshot),
    context: ClientToolCallContext = task,
  ) => opened.session.execute(input, { ...context, hostGrant: grant });
  return { ...opened, snapshot, child };
}

const sectionRef = (snapshot: WordAuthoringSnapshot) =>
  snapshot.blocks.find((b) => b.text === "1.2 Section 1.2")!.ref;

const expectLoss = (result: ClientToolExecutionResult) => {
  expect(result).toMatchObject({
    ok: false,
    validationErrors: [{ code: "capture-unavailable" }],
    submissionFeedback: { terminal: true, recovery: "cannot_continue" },
  });
  expect(JSON.stringify(result)).not.toContain("Supplier");
};

describe("a delegated task's read under the server's grant", () => {
  it("reads every read-only shape, fills in the capture's snapshot and identity, and leaves the coordinator's state alone", async () => {
    const { child, snapshot, execute } = open();
    const ref = sectionRef(snapshot);
    const reads = [
      { section: { ref } },
      { target: { text: "Payment is due net 30" } },
      {
        target: {
          queries: [{ text: "Payment is due net 30" }, { ref: "b2" }],
        },
      },
      { table_cell: { header: "Hours", rowLabel: "West" } },
    ];
    for (const read of reads) {
      for (const input of [
        read,
        { ...read, snapshot: "forged", documentIdentity: "guessed" },
      ]) {
        const result = okResult(await child(input));
        expect(result).toMatchObject({ access: "read-only" });
        expect(JSON.stringify(result)).not.toContain("readToken");
      }
    }
    expect(writeState(snapshot)).toEqual(untouchedWriteState);

    const paragraphs = snapshot.blocks.filter((b) => b.type === "paragraph");
    const tokens = new Set<string>();
    for (const b of paragraphs.slice(0, 16)) {
      const scoped = okResult<{ status: string; readToken: string }>(
        await execute({ target: { ref: b.ref } }),
      );
      expect(scoped.status).toBe("ready");
      tokens.add(scoped.readToken);
    }
    expect(tokens.size).toBe(16);
  });

  it("refuses a complete read without ending the task's read", async () => {
    const { child, snapshot } = open();
    const refused = await child({ cursor: null });
    expect(refused).toMatchObject({
      ok: false,
      validationErrors: [{ code: "read-only-complete" }],
    });
    expect(refused).not.toHaveProperty("submissionFeedback");
    expect(snapshot.read.size).toBe(0);
  });

  it.each<[string, (grant: ClientToolHostGrant) => ClientToolHostGrant]>([
    ["another requesting chat", (g) => ({ ...g, requestingChatId: "x" })],
    ["another requesting message", (g) => ({ ...g, requestingMessageId: "x" })],
    ["a foreign owner chat", (g) => ({ ...g, ownerChatId: "x" })],
    ["a foreign owner message", (g) => ({ ...g, ownerMessageId: "x" })],
    ["a forged context version", (g) => ({ ...g, contextRef: "forged" })],
    ["no context version", ({ contextRef: _ref, ...g }) => g],
  ])("ends with capture-unavailable under %s", async (_name, change) => {
    const { child, snapshot } = open();
    expectLoss(
      await child(
        { section: { ref: sectionRef(snapshot) } },
        change(grantOf(snapshot)),
      ),
    );
    expect(writeState(snapshot)).toEqual(untouchedWriteState);
  });

  it("ends with capture-unavailable once a new Send captured again, reads the newer capture only under its own grant, and not once it is cleared", async () => {
    const { child, session, snapshot } = open();
    const ref = sectionRef(snapshot);
    okResult(await child({ section: { ref } }));
    const newer = snapshotOf();
    session.activate(newer, { ...readContext, messageId: "message-B" });
    expectLoss(await child({ section: { ref } }));
    expectLoss(
      await child(
        { section: { ref } },
        {
          ...grantOf(snapshot),
          ownerMessageId: "message-B",
        },
      ),
    );
    const newerGrant = { ...grantOf(newer), ownerMessageId: "message-B" };
    const newerRead = { section: { ref: sectionRef(newer) } };
    okResult(await child(newerRead, newerGrant));
    session.clear();
    expectLoss(await child(newerRead, newerGrant));
  });

  it.each(["used", "revoked"] as const)(
    "ends with capture-unavailable once the capture is %s",
    async (state) => {
      const { child, snapshot } = open();
      snapshot[state] = true;
      expectLoss(await child({ section: { ref: sectionRef(snapshot) } }));
    },
  );

  it("still reads the same capture after the parent's continuation on the same message", async () => {
    const { child, session, snapshot } = open();
    const ref = sectionRef(snapshot);
    const before = okResult<{ freshness: { context_ref: string } }>(
      await child({ section: { ref } }),
    );
    expect(session.bindRequest(snapshot.token, readContext)).toBe(true);
    const after = okResult<{ freshness: { context_ref: string } }>(
      await child({ section: { ref } }, grantOf(snapshot), {
        ...task,
        toolCallId: "task-call-2",
      }),
    );
    expect(after.freshness.context_ref).toBe(snapshot.token);
    expect(after).toEqual(before);
  });
});
