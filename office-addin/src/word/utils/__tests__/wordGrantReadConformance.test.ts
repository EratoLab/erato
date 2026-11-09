import { clientToolHostAdapterConformanceFailures } from "@erato/frontend/conformance";
import { registerOperationExecutor } from "@erato/frontend/library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  body,
  chapter,
  heading,
  sectionSnapshot,
  table,
} from "../../../test/mocks/word/sectionFixtures";
import {
  beginWordOwnWrite,
  nameWordOwnWriteIds,
  noteWordActiveChat,
  noteWordCapturedIds,
  noteWordChangeEventsActive,
  recordWordParagraphEvent,
  resetWordChangeJournalForTests,
  wordChangePosition,
} from "../wordChangeJournal";
import { registerWordClientTools } from "../wordClientTools";
import { WORD_SUBMIT_COMMENT_CHANGES_TOOL } from "../wordCommentSubmission";
import {
  wordDocumentReadSession,
  WORD_READ_TOOL,
} from "../wordDocumentReadTool";
import { WORD_SUBMIT_PLAN_TOOL } from "../wordDocumentSubmission";

import type { WordDocumentBuild } from "../buildWordDocumentArgs";
import type { ClientToolHostConformanceHarness } from "@erato/frontend/conformance";
import type { ExecutorBinding } from "@erato/frontend/library";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

const OWNER_CHAT = "word-owner-chat";
const IDENTITY = "b".repeat(64);
const BINDING: ExecutorBinding = {
  device_id: "word-device",
  realm: "office-addin",
  host_context: { kind: "word_document", identity: IDENTITY },
};
const BLOCKS = [
  body("Master Services Agreement"),
  ...chapter(1, 8),
  heading(1, "Fees"),
  body("Payment is due net 30."),
  table([
    ["Team", "Hours"],
    ["West", "21"],
  ]),
];

/** A capture of the same document, as a Send takes it: its paragraph ids by ordinal. */
function capture(): {
  snapshot: WordAuthoringSnapshot;
  ordinalMap: WordDocumentBuild["ordinalMap"];
  ids: string[];
} {
  const snapshot = sectionSnapshot(BLOCKS);
  const ordinalMap: WordDocumentBuild["ordinalMap"] = new Map();
  const ids: string[] = [];
  for (const block of snapshot.blocks) {
    const texts =
      block.type === "native"
        ? block.content!.rows.flatMap((row) => row.cells.map((c) => c.text))
        : [block.text];
    for (const text of texts) {
      ids.push(`p${ids.length + 1}`);
      ordinalMap.set(ids.length, { uniqueLocalId: ids.at(-1)!, text });
    }
    if (block.type !== "native") block.paragraphOrdinal = ids.length;
  }
  return { snapshot, ordinalMap, ids };
}

const SECTION_REF = capture().snapshot.blocks.find(
  (b) => b.text === "1.2 Section 1.2",
)!.ref;
/** As the task's model sends them; the server fills snapshot and drops documentIdentity. */
const modelInput = (read: Record<string, unknown>) => ({
  snapshot: "model-guess",
  documentIdentity: "model-guess",
  ...read,
});
const sectionRead = {
  tool: WORD_READ_TOOL,
  input: modelInput({ section: { ref: SECTION_REF } }),
};

/** The pane's paragraph events reach the journal, as installParagraphEvents notes them. */
function paneLoaded(events: boolean): void {
  if (events) noteWordChangeEventsActive();
  noteWordActiveChat(OWNER_CHAT);
}

function harness(events: boolean): ClientToolHostConformanceHarness {
  let turns = 0;
  let current: WordAuthoringSnapshot | undefined;
  let ids: string[] = [];
  const session = wordDocumentReadSession as unknown as {
    session: { next: number; chatId: string | null } | null;
    access: string;
    drafts: unknown;
  };
  return {
    hostContext: "word_document",
    lossCode: "capture-unavailable",
    contextInput: "snapshot",
    hostInputs: ["documentIdentity"],
    startTurn: async () => {
      turns += 1;
      paneLoaded(events);
      const taken = capture();
      ids = taken.ids;
      noteWordCapturedIds(ids);
      const ownerMessageId = `word-owner-message-${turns}`;
      wordDocumentReadSession.activate(
        taken.snapshot,
        { chatId: OWNER_CHAT, messageId: ownerMessageId },
        undefined,
        {
          capture: {
            changes: {
              position: wordChangePosition(),
              capturedAt: new Date().toISOString(),
            },
            ordinalMap: taken.ordinalMap,
          },
        },
      );
      current = taken.snapshot;
      return {
        ownerChatId: OWNER_CHAT,
        ownerMessageId,
        contextRef: taken.snapshot.token,
      };
    },
    coordinatorState: () => ({
      read: current?.read,
      readScopes: current?.readScopes,
      readToken: current?.readToken,
      used: current?.used,
      revoked: current?.revoked,
      ownerMessageId: current?.ownerMessageId,
      next: session.session?.next,
      chatId: session.session?.chatId,
      access: session.access,
      drafts: session.drafts,
    }),
    reads: [
      sectionRead,
      {
        tool: WORD_READ_TOOL,
        input: modelInput({ target: { text: "Payment is due net 30" } }),
      },
      {
        tool: WORD_READ_TOOL,
        input: modelInput({
          target: {
            queries: [{ text: "Payment is due net 30" }, { ref: "b2" }],
          },
        }),
      },
      {
        tool: WORD_READ_TOOL,
        input: modelInput({
          table_cell: { header: "Hours", rowLabel: "West" },
        }),
      },
    ],
    writes: [
      {
        tool: WORD_SUBMIT_PLAN_TOOL,
        input: { snapshot: "model-guess", readToken: "guess", scoped_edit: {} },
      },
      { tool: WORD_SUBMIT_COMMENT_CHANGES_TOOL, input: { changes: [] } },
    ],
    writeMarkers: {
      fields: ["readToken", "contract", "scopedEdit"],
      phrases: ["scoped_edit", "submit_document_plan"],
    },
    blindSpots: events
      ? [
          {
            name: "another pane load",
            apply: () => {
              resetWordChangeJournalForTests();
              paneLoaded(true);
            },
          },
          {
            name: "an unknown-source entry: Word replaced the capture's paragraph ids",
            apply: () =>
              recordWordParagraphEvent({
                type: "ParagraphDeleted",
                source: "Local",
                uniqueLocalIds: ids,
              }),
          },
        ]
      : [{ name: "a pane without paragraph events", apply: () => {} }],
    ...(events
      ? {
          approvalScope: {
            read: sectionRead,
            readCount: () => readOnly.mock.calls.length,
            scopeId: () => IDENTITY,
            changeFromOutside: () =>
              recordWordParagraphEvent({
                type: "ParagraphChanged",
                source: "Local",
                uniqueLocalIds: [ids[4]],
              }),
            changeOwn: () => {
              const write = beginWordOwnWrite("ids");
              nameWordOwnWriteIds([ids[5]]);
              recordWordParagraphEvent({
                type: "ParagraphChanged",
                source: "Local",
                uniqueLocalIds: [ids[5]],
              });
              write.end();
            },
            reload: () => {
              resetWordChangeJournalForTests();
              paneLoaded(true);
            },
          },
        }
      : {}),
  };
}

const readOnly = vi.spyOn(wordDocumentReadSession, "executeReadOnly");
let unregister: (() => void)[] = [];

beforeEach(() => {
  resetWordChangeJournalForTests();
  readOnly.mockClear();
  unregister = [
    registerWordClientTools({
      readEnabled: () => true,
      bindingIdentity: () => IDENTITY,
    }),
    registerOperationExecutor(WORD_READ_TOOL, () => BINDING, { yields: true }),
  ];
});

afterEach(() => {
  unregister.forEach((stop) => stop());
  wordDocumentReadSession.clear();
  resetWordChangeJournalForTests();
});

describe("the Word pane as a host of delegated reads", () => {
  it("passes clientToolHostAdapterConformanceFailures in a pane without paragraph events, where every call asks", async () => {
    expect(
      await clientToolHostAdapterConformanceFailures(harness(false)),
    ).toEqual([]);
  });

  it("passes the approval scope rules with paragraph events, registered with wordApprovalScopeOptions and checked with checkWordApprovalScope", async () => {
    paneLoaded(true);
    expect(
      await clientToolHostAdapterConformanceFailures(harness(true)),
    ).toEqual([]);
  });
});
