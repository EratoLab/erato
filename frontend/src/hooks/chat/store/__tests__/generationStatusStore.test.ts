import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  selectAttentionCount,
  selectRunningCount,
  useGenerationStatusStore,
} from "../generationStatusStore";

import type { GeneratingChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const T0 = new Date("2026-07-22T10:00:00.000Z");
const iso = (offsetMs: number) =>
  new Date(T0.getTime() + offsetMs).toISOString();

const runningEntry = (
  chatId: string,
  startedAtOffsetMs = 0,
): GeneratingChat => ({
  chat_id: chatId,
  state: "running",
  started_at: iso(startedAtOffsetMs),
});

const terminalEntry = (
  chatId: string,
  state: "completed" | "errored",
  startedAtOffsetMs = 0,
): GeneratingChat => ({
  chat_id: chatId,
  state,
  started_at: iso(startedAtOffsetMs),
  ended_at: iso(startedAtOffsetMs + 1000),
});

describe("generationStatusStore", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    useGenerationStatusStore.setState({
      statusByChatId: {},
      currentChatId: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const store = () => useGenerationStatusStore.getState();
  const statusOf = (chatId: string) => store().statusByChatId[chatId];

  describe("seedRunning", () => {
    it("marks a chat running", () => {
      store().seedRunning("chat-1", iso(0));
      expect(statusOf("chat-1")).toEqual({
        kind: "running",
        startedAt: iso(0),
        localSeenAt: T0.getTime(),
      });
    });

    it("is idempotent: re-seeding the same generation keeps the first observation", () => {
      store().seedRunning("chat-1", iso(0));
      vi.advanceTimersByTime(5_000);
      store().seedRunning("chat-1", iso(0));
      expect(statusOf("chat-1")).toMatchObject({ localSeenAt: T0.getTime() });
    });

    it("replaces a running entry only for a newer generation", () => {
      store().seedRunning("chat-1", iso(1_000));
      store().seedRunning("chat-1", iso(0));
      expect(statusOf("chat-1")).toMatchObject({ startedAt: iso(1_000) });

      store().seedRunning("chat-1", iso(2_000));
      expect(statusOf("chat-1")).toMatchObject({ startedAt: iso(2_000) });
    });

    it("does not downgrade a terminal state for a generation that predates it", () => {
      store().seedRunning("chat-1", iso(0));
      store().markTerminalLocal("chat-1", "finished");
      // Stale list row still carrying the finished generation's start time.
      store().seedRunning("chat-1", iso(0));
      expect(statusOf("chat-1")).toMatchObject({ kind: "finished" });
    });

    it("upgrades a terminal state back to running for a newer generation", () => {
      store().seedRunning("chat-1", iso(0));
      store().markTerminalLocal("chat-1", "error");
      vi.advanceTimersByTime(60_000);
      store().seedRunning("chat-1", iso(30_000));
      expect(statusOf("chat-1")).toMatchObject({
        kind: "running",
        startedAt: iso(30_000),
      });
    });
  });

  describe("applyPollSnapshot", () => {
    it("marks snapshot running entries as running", () => {
      store().applyPollSnapshot([runningEntry("chat-1")]);
      expect(statusOf("chat-1")).toMatchObject({
        kind: "running",
        startedAt: iso(0),
      });
    });

    it("transitions a running chat to finished/error", () => {
      store().seedRunning("chat-1", iso(0));
      store().seedRunning("chat-2", iso(0));
      vi.advanceTimersByTime(11_000);
      store().applyPollSnapshot([
        terminalEntry("chat-1", "completed"),
        terminalEntry("chat-2", "errored"),
      ]);
      expect(statusOf("chat-1")).toMatchObject({ kind: "finished" });
      expect(statusOf("chat-2")).toMatchObject({ kind: "error" });
    });

    it("ignores terminal entries for chats never observed running (refresh bootstrap)", () => {
      store().applyPollSnapshot([terminalEntry("chat-1", "completed")]);
      expect(statusOf("chat-1")).toBeUndefined();
    });

    it("ignores terminal entries for chats already terminal", () => {
      store().seedRunning("chat-1", iso(0));
      store().markTerminalLocal("chat-1", "error");
      store().applyPollSnapshot([terminalEntry("chat-1", "completed")]);
      expect(statusOf("chat-1")).toMatchObject({ kind: "error" });
    });

    it("clears instead of marking terminal for the currently viewed chat", () => {
      store().seedRunning("chat-1", iso(0));
      store().setCurrentChatId("chat-1");
      vi.advanceTimersByTime(11_000);
      store().applyPollSnapshot([terminalEntry("chat-1", "completed")]);
      expect(statusOf("chat-1")).toMatchObject({ kind: "cleared" });
    });

    it("clears running chats absent from the snapshot once the seed grace passed", () => {
      store().seedRunning("chat-1", iso(0));
      vi.advanceTimersByTime(11_000);
      store().applyPollSnapshot([]);
      expect(statusOf("chat-1")).toMatchObject({
        kind: "cleared",
        startedAt: iso(0),
      });
    });

    it("keeps a terminal status when the chat drops out of the snapshot (retention expiry)", () => {
      store().seedRunning("chat-1", iso(0));
      vi.advanceTimersByTime(11_000);
      store().applyPollSnapshot([terminalEntry("chat-1", "completed")]);
      vi.advanceTimersByTime(120_000);
      store().applyPollSnapshot([]);
      expect(statusOf("chat-1")).toMatchObject({ kind: "finished" });
    });

    it("does not re-seed a consumed generation from a stale list row", () => {
      store().seedRunning("chat-1", iso(0));
      vi.advanceTimersByTime(11_000);
      store().applyPollSnapshot([terminalEntry("chat-1", "completed")]);
      store().setCurrentChatId("chat-1");
      store().setCurrentChatId(null);
      // Cached list row fetched mid-run still carries the running marker.
      store().seedRunning("chat-1", iso(0));
      expect(statusOf("chat-1")).toMatchObject({ kind: "cleared" });
      // A retention-window poll entry for the same generation stays consumed.
      store().applyPollSnapshot([terminalEntry("chat-1", "completed")]);
      expect(statusOf("chat-1")).toMatchObject({ kind: "cleared" });
    });

    it("revives a consumed chat for a genuinely newer generation", () => {
      store().seedRunning("chat-1", iso(0));
      vi.advanceTimersByTime(11_000);
      store().applyPollSnapshot([terminalEntry("chat-1", "completed")]);
      store().setCurrentChatId("chat-1");
      store().setCurrentChatId(null);
      store().seedRunning("chat-1", iso(30_000));
      expect(statusOf("chat-1")).toMatchObject({
        kind: "running",
        startedAt: iso(30_000),
      });
    });

    it("ignores a stale terminal snapshot racing a just-started generation", () => {
      // First turn completes while the user views the chat: consumed.
      store().setCurrentChatId("chat-1");
      store().seedRunning("chat-1", iso(0));
      vi.advanceTimersByTime(11_000);
      store().applyPollSnapshot([terminalEntry("chat-1", "completed", 0)]);
      expect(statusOf("chat-1")).toMatchObject({ kind: "cleared" });

      // Second message: the send path seeds running and re-enables the poll.
      vi.advanceTimersByTime(19_000);
      store().seedRunning("chat-1", iso(30_000));
      expect(statusOf("chat-1")).toMatchObject({ kind: "running" });

      // The first poll raced the new generation's lease write and still
      // reports the previous generation's retention row.
      vi.advanceTimersByTime(500);
      store().applyPollSnapshot([terminalEntry("chat-1", "completed", 0)]);
      expect(statusOf("chat-1")).toMatchObject({ kind: "running" });

      // Fresh snapshots confirm running; the entry must survive.
      vi.advanceTimersByTime(3_000);
      store().applyPollSnapshot([runningEntry("chat-1", 30_500)]);
      expect(statusOf("chat-1")).toMatchObject({ kind: "running" });
    });

    it("applies a terminal snapshot once the running entry outlives the seed grace", () => {
      store().seedRunning("chat-1", iso(0));
      vi.advanceTimersByTime(500);
      // Within grace: skipped even though the chat is not being viewed.
      store().applyPollSnapshot([terminalEntry("chat-1", "errored", 0)]);
      expect(statusOf("chat-1")).toMatchObject({ kind: "running" });

      vi.advanceTimersByTime(11_000);
      store().applyPollSnapshot([terminalEntry("chat-1", "errored", 0)]);
      expect(statusOf("chat-1")).toMatchObject({ kind: "error" });
    });

    it("keeps the grace anchored to the first seed across poll confirmations", () => {
      store().seedRunning("chat-1", iso(0));
      // Poll confirms with the server's slightly newer start time; this must
      // not restart the grace window.
      vi.advanceTimersByTime(3_000);
      store().applyPollSnapshot([runningEntry("chat-1", 400)]);
      vi.advanceTimersByTime(8_000);
      store().applyPollSnapshot([terminalEntry("chat-1", "completed", 400)]);
      expect(statusOf("chat-1")).toMatchObject({ kind: "finished" });
    });

    it("does not flap between running and unknown for the same absent generation", () => {
      store().seedRunning("chat-1", iso(0));
      vi.advanceTimersByTime(11_000);
      store().applyPollSnapshot([]);
      // Layout remount re-runs the list seed with the same cached row.
      store().seedRunning("chat-1", iso(0));
      expect(statusOf("chat-1")).toMatchObject({ kind: "cleared" });
    });

    it("keeps recently seeded running chats absent from the snapshot (grace)", () => {
      store().seedRunning("chat-1", iso(0));
      vi.advanceTimersByTime(5_000);
      store().applyPollSnapshot([]);
      expect(statusOf("chat-1")).toMatchObject({ kind: "running" });
    });

    it("does not resurrect a stale running entry over a local terminal observation", () => {
      store().seedRunning("chat-1", iso(0));
      store().markTerminalLocal("chat-1", "finished");
      // Poll response that was already in flight when the turn completed.
      store().applyPollSnapshot([runningEntry("chat-1")]);
      expect(statusOf("chat-1")).toMatchObject({ kind: "finished" });
    });
  });

  describe("markTerminalLocal", () => {
    it("records finished and error outcomes", () => {
      store().seedRunning("chat-1", iso(0));
      store().markTerminalLocal("chat-1", "finished");
      expect(statusOf("chat-1")).toMatchObject({ kind: "finished" });

      store().seedRunning("chat-2", iso(0));
      store().markTerminalLocal("chat-2", "error");
      expect(statusOf("chat-2")).toMatchObject({ kind: "error" });
    });

    it("clears instead for the currently viewed chat", () => {
      store().setCurrentChatId("chat-1");
      store().seedRunning("chat-1", iso(0));
      store().markTerminalLocal("chat-1", "finished");
      expect(statusOf("chat-1")).toMatchObject({
        kind: "cleared",
        startedAt: iso(0),
      });
    });
  });

  describe("setCurrentChatId", () => {
    it("clears a terminal status on the chat being navigated to", () => {
      store().seedRunning("chat-1", iso(0));
      store().markTerminalLocal("chat-1", "finished");
      store().setCurrentChatId("chat-1");
      expect(statusOf("chat-1")).toMatchObject({
        kind: "cleared",
        startedAt: iso(0),
      });
      expect(store().currentChatId).toBe("chat-1");
    });

    it("keeps a running status on the chat being navigated to", () => {
      store().seedRunning("chat-1", iso(0));
      store().setCurrentChatId("chat-1");
      expect(statusOf("chat-1")).toMatchObject({ kind: "running" });
    });
  });

  describe("selectors", () => {
    it("counts running and attention states separately", () => {
      store().seedRunning("chat-1", iso(0));
      store().seedRunning("chat-2", iso(0));
      store().markTerminalLocal("chat-2", "finished");
      store().seedRunning("chat-3", iso(0));
      store().markTerminalLocal("chat-3", "error");

      expect(selectRunningCount(store())).toBe(1);
      expect(selectAttentionCount(store())).toBe(2);
    });

    it("excludes cleared tombstones from both counts", () => {
      store().seedRunning("chat-1", iso(0));
      store().markTerminalLocal("chat-1", "finished");
      store().setCurrentChatId("chat-1");

      expect(statusOf("chat-1")).toMatchObject({ kind: "cleared" });
      expect(selectRunningCount(store())).toBe(0);
      expect(selectAttentionCount(store())).toBe(0);
    });
  });

  describe("clearStatus / reset", () => {
    it("clears a single chat and resets everything", () => {
      store().seedRunning("chat-1", iso(0));
      store().seedRunning("chat-2", iso(0));
      store().setCurrentChatId("chat-1");

      store().clearStatus("chat-1");
      expect(statusOf("chat-1")).toBeUndefined();
      expect(statusOf("chat-2")).toBeDefined();

      store().reset();
      expect(store().statusByChatId).toEqual({});
      expect(store().currentChatId).toBeNull();
    });
  });
});
