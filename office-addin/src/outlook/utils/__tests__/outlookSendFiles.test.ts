import { describe, expect, it } from "vitest";

import { planOutlookFiles } from "../outlookSendFiles";

import type {
  OutlookFilePlanInput,
  OutlookFilePlanThreadInput,
} from "../outlookSendFiles";

const threadFile = new File(["thread"], "thread.eml");
const dropFile = new File(["drop"], "drop.eml");

const readyThread = (
  over: Partial<OutlookFilePlanThreadInput> = {},
): OutlookFilePlanThreadInput => ({
  status: "ready",
  signIn: null,
  messageCount: 5,
  includedMessageCount: 5,
  file: threadFile,
  stale: false,
  partKey: "current-thread:conv-1",
  trimError: false,
  conversationId: "conv-1",
  choice: null,
  sentInChat: false,
  stagedAsDrop: false,
  ...over,
});

const input = (
  over: Partial<Omit<OutlookFilePlanInput, "thread" | "attachments">> & {
    thread?: Partial<OutlookFilePlanThreadInput>;
    attachments?: Partial<OutlookFilePlanInput["attachments"]>;
  } = {},
): OutlookFilePlanInput => ({
  freshChat: true,
  drops: [],
  dropsStale: false,
  ...over,
  thread: readyThread(over.thread),
  attachments: {
    mode: "read",
    items: [],
    loading: false,
    groupOff: false,
    includeOnFollowUpIds: new Set(),
    sentIds: new Set(),
    ...over.attachments,
  },
});

const drop = { key: "drop-1", file: dropFile, size: 4, error: false };

describe("planOutlookFiles", () => {
  describe("the open thread, first match wins", () => {
    it.each<[string, Parameters<typeof input>[0], unknown]>([
      [
        "no thread for the item",
        { thread: { status: "none" } },
        { kind: "none" },
      ],
      [
        "the open email staged as a drop",
        { thread: { stagedAsDrop: true } },
        { kind: "hidden", why: "dropped" },
      ],
      [
        "sent earlier in this chat",
        { freshChat: false, thread: { sentInChat: true } },
        { kind: "hidden", why: "sent-in-chat" },
      ],
      [
        "a sent record on a chat that is fresh again",
        { thread: { sentInChat: true } },
        { kind: "sent", included: 5, total: 5 },
      ],
      [
        "loading on a fresh chat",
        { thread: { status: "loading", file: null } },
        { kind: "loading" },
      ],
      [
        "loading on a follow-up with no choice",
        { freshChat: false, thread: { status: "loading", file: null } },
        { kind: "follow-up", retry: false },
      ],
      [
        "a load error on a follow-up",
        { freshChat: false, thread: { status: "error", file: null } },
        { kind: "follow-up", retry: true },
      ],
      [
        "a sign-in on a follow-up",
        {
          freshChat: false,
          thread: { status: "error", file: null, signIn: "sign-in" },
        },
        { kind: "follow-up", retry: true },
      ],
      [
        "a load error after (+) on a follow-up",
        {
          freshChat: false,
          thread: { status: "error", file: null, choice: "included" },
        },
        { kind: "error", why: "load" },
      ],
      [
        "loading after (+) on a follow-up",
        {
          freshChat: false,
          thread: { status: "loading", file: null, choice: "included" },
        },
        { kind: "loading" },
      ],
      [
        "loading after (x)",
        { thread: { status: "loading", file: null, choice: "excluded" } },
        { kind: "off", retry: false },
      ],
      [
        "a load error",
        { thread: { status: "error", file: null } },
        { kind: "error", why: "load" },
      ],
      [
        "a sign-in the load needs",
        { thread: { status: "error", file: null, signIn: "sign-in" } },
        { kind: "sign-in", consent: false },
      ],
      [
        "a grant the load needs",
        { thread: { status: "error", file: null, signIn: "consent" } },
        { kind: "sign-in", consent: true },
      ],
      [
        "an error left out",
        { thread: { status: "error", file: null, choice: "excluded" } },
        { kind: "off", retry: true },
      ],
      [
        "left out",
        { thread: { choice: "excluded" } },
        { kind: "off", retry: false },
      ],
      [
        "a follow-up",
        { freshChat: false },
        { kind: "follow-up", retry: false },
      ],
      [
        "every message unticked",
        { thread: { includedMessageCount: 0, file: null } },
        { kind: "nothing" },
      ],
      [
        "a trim the bytes refuse",
        { thread: { trimError: true, file: null } },
        { kind: "error", why: "trim" },
      ],
      [
        "a partial choice",
        { thread: { includedMessageCount: 3 } },
        { kind: "sent", included: 3, total: 5 },
      ],
      [
        "(+) on a follow-up",
        { freshChat: false, thread: { choice: "included" } },
        { kind: "sent", included: 5, total: 5 },
      ],
      [
        "sent earlier and added again",
        { freshChat: false, thread: { choice: "included", sentInChat: true } },
        { kind: "sent", included: 5, total: 5 },
      ],
    ])("%s", (_name, over, expected) => {
      expect(planOutlookFiles(input(over)).thread).toEqual(expected);
    });

    it("uploads the thread only when it goes, and waits only while it loads to go", () => {
      const sent = planOutlookFiles(input());
      expect(sent.uploadThread).toBe(true);
      expect(sent.uploads).toBe(true);
      expect(sent.parts).toEqual([
        { key: "current-thread:conv-1", name: "thread.eml", size: 6 },
      ]);
      expect(sent.waitingForThread).toBe(false);

      const loading = planOutlookFiles(
        input({ thread: { status: "loading", file: null } }),
      );
      expect(loading.uploadThread).toBe(false);
      expect(loading.waitingForThread).toBe(true);

      for (const over of [
        { freshChat: false },
        { thread: { choice: "excluded" as const } },
        { thread: { status: "error" as const, file: null } },
        { freshChat: false, thread: { sentInChat: true } },
        { thread: { trimError: true } },
      ]) {
        const plan = planOutlookFiles(input(over));
        expect(plan.uploadThread).toBe(false);
        expect(plan.uploads).toBe(false);
        expect(plan.parts).toEqual([]);
        expect(plan.waitingForThread).toBe(false);
      }
    });

    it("waits while the thread that goes has no current file", () => {
      const firstBuild = planOutlookFiles(input({ thread: { file: null } }));
      expect(firstBuild.thread).toEqual({
        kind: "sent",
        included: 5,
        total: 5,
      });
      expect(firstBuild.waitingForThread).toBe(true);
      expect(firstBuild.parts).toEqual([]);

      const rebuilding = planOutlookFiles(input({ thread: { stale: true } }));
      expect(rebuilding.uploadThread).toBe(true);
      expect(rebuilding.waitingForThread).toBe(true);

      // A thread that stays behind holds nothing up, stale or not.
      const leftOut = planOutlookFiles(
        input({ thread: { stale: true, choice: "excluded" } }),
      );
      expect(leftOut.waitingForThread).toBe(false);
    });

    it("waits while a drop's file rebuilds after a tick", () => {
      expect(
        planOutlookFiles(input({ drops: [drop], dropsStale: true }))
          .waitingForDrops,
      ).toBe(true);
      expect(planOutlookFiles(input({ drops: [drop] })).waitingForDrops).toBe(
        false,
      );
      expect(
        planOutlookFiles(input({ dropsStale: true })).waitingForDrops,
      ).toBe(false);
    });

    it("sends only the drop on a follow-up with a drop staged", () => {
      const plan = planOutlookFiles(input({ freshChat: false, drops: [drop] }));

      expect(plan.thread).toEqual({ kind: "follow-up", retry: false });
      expect(plan.uploadThread).toBe(false);
      expect(plan.uploads).toBe(true);
      expect(plan.parts).toEqual([
        { key: "drop-1", name: "drop.eml", size: 4 },
      ]);
    });

    it("sends only the drop when the open email is itself dropped", () => {
      const plan = planOutlookFiles(
        input({
          freshChat: false,
          drops: [drop],
          thread: { stagedAsDrop: true },
        }),
      );

      expect(plan.thread).toEqual({ kind: "hidden", why: "dropped" });
      expect(plan.uploadThread).toBe(false);
      expect(plan.parts.map((part) => part.key)).toEqual(["drop-1"]);
    });

    it("lets a send go without a trim-failed thread that is left out", () => {
      const plan = planOutlookFiles(
        input({
          thread: { trimError: true, choice: "excluded" },
          drops: [drop],
        }),
      );

      expect(plan.thread).toEqual({ kind: "off", retry: false });
      expect(plan.uploads).toBe(true);
    });
  });

  describe("Office.js attachments", () => {
    const items = [
      { id: "a1", cloud: false, ticked: true },
      { id: "a2", cloud: false, ticked: true },
    ];
    const compose = (
      over: Partial<OutlookFilePlanInput["attachments"]> = {},
      rest: Parameters<typeof input>[0] = {},
    ) =>
      planOutlookFiles(
        input({
          ...rest,
          thread: { status: "none", file: null, ...rest.thread },
          attachments: { mode: "compose", items, ...over },
        }),
      );

    it("sends a draft's attachments on a fresh chat", () => {
      const plan = compose();
      expect(plan.attachments).toEqual([
        { id: "a1", disposition: "sent" },
        { id: "a2", disposition: "sent" },
      ]);
      expect(plan.composeAttachmentIds).toEqual(["a1", "a2"]);
      expect(plan.uploads).toBe(true);
    });

    it.each<[string, Parameters<typeof compose>, string]>([
      [
        "an unticked one",
        [{ items: [{ id: "a1", cloud: false, ticked: false }] }],
        "off",
      ],
      [
        "a cloud file",
        [{ items: [{ id: "a1", cloud: true, ticked: true }] }],
        "cloud",
      ],
      [
        "an unticked cloud file",
        [{ items: [{ id: "a1", cloud: true, ticked: false }] }],
        "off",
      ],
      ["the group off", [{ groupOff: true }], "off"],
      [
        "one sent earlier",
        [{ sentIds: new Set(["a1"]) }, { freshChat: false }],
        "sent-earlier",
      ],
      [
        "a sent record on a chat that is fresh again",
        [{ sentIds: new Set(["a1"]) }],
        "sent",
      ],
      ["a drop staged", [{}, { drops: [drop] }], "not-with-drops"],
      ["a follow-up", [{}, { freshChat: false }], "follow-up"],
      [
        "a follow-up after (+)",
        [{ includeOnFollowUpIds: new Set(["a1"]) }, { freshChat: false }],
        "sent",
      ],
    ])("reads %s", (_name, args, disposition) => {
      expect(compose(...args).attachments[0]?.disposition).toBe(disposition);
    });

    it("includes a follow-up attachment only for the one (+) was pressed on", () => {
      const plan = compose(
        { includeOnFollowUpIds: new Set(["a2"]) },
        { freshChat: false },
      );
      expect(plan.composeAttachmentIds).toEqual(["a2"]);
    });

    it("never uploads a cloud file, and keeps Office.js attachments out while a drop is staged", () => {
      expect(
        compose({ items: [{ id: "a1", cloud: true, ticked: true }] })
          .composeAttachmentIds,
      ).toEqual([]);
      const withDrop = compose({}, { drops: [drop] });
      expect(withDrop.composeAttachmentIds).toEqual([]);
      expect(withDrop.parts.map((part) => part.key)).toEqual(["drop-1"]);
    });

    it("shows none while Office.js still reports them", () => {
      const plan = compose({ loading: true });
      expect(plan.attachments).toEqual([]);
      expect(plan.composeAttachmentIds).toEqual([]);
    });

    it("sends a read email's attachments only without a thread or when it failed", () => {
      const read = (thread: Partial<OutlookFilePlanThreadInput>) =>
        planOutlookFiles(
          input({ thread, attachments: { mode: "read", items } }),
        );

      expect(read({ status: "none", file: null }).composeAttachmentIds).toEqual(
        ["a1", "a2"],
      );
      expect(
        read({ status: "error", file: null }).composeAttachmentIds,
      ).toEqual(["a1", "a2"]);
      expect(read({}).attachments).toEqual([]);
      expect(read({ status: "loading", file: null }).attachments).toEqual([]);
      expect(
        read({ status: "loading", file: null, choice: "excluded" }).attachments,
      ).toEqual([]);
    });
  });

  it("uploads every drop in order and marks one whose trim failed", () => {
    const plan = planOutlookFiles(
      input({
        thread: { status: "none", file: null },
        drops: [drop, { key: "drop-2", file: null, size: 0, error: true }],
      }),
    );
    expect(plan.drops).toEqual([
      { key: "drop-1", state: "sent" },
      { key: "drop-2", state: "error" },
    ]);
    expect(plan.parts.map((part) => part.key)).toEqual(["drop-1"]);
    expect(plan.uploads).toBe(true);
  });
});
