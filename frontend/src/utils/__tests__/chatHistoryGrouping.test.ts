import { i18n, type Messages } from "@lingui/core";
import { beforeAll, describe, expect, it } from "vitest";

import enMessages from "@/locales/en/messages.json";
import {
  groupChatSessions,
  resolveChatAttentionStatus,
  type GroupChatSessionsDeps,
} from "@/utils/chatHistoryGrouping";

import type { ChatHistoryGroupBy } from "@/hooks/chat/store/chatHistoryFilterStore";
import type { ChatGenerationStatus } from "@/hooks/chat/store/generationStatusStore";
import type { ChatSession } from "@/types/chat";

beforeAll(() => {
  i18n.load("en", enMessages.messages as unknown as Messages);
  i18n.activate("en");
});

const session = (
  id: string,
  updatedAt: string,
  assistantId?: string,
): ChatSession => ({
  id,
  title: id,
  messages: [],
  updatedAt,
  assistantId,
});

// A Friday afternoon, local time.
const NOW = new Date(2026, 7, 14, 15, 30, 0);

const deps = (
  overrides: Partial<GroupChatSessionsDeps> = {},
): GroupChatSessionsDeps => ({
  now: NOW,
  locale: "en",
  needsAttention: () => false,
  ...overrides,
});

const localIso = (
  year: number,
  month: number,
  day: number,
  hour = 12,
): string => new Date(year, month, day, hour).toISOString();

describe("resolveChatAttentionStatus", () => {
  const running: ChatGenerationStatus = {
    kind: "running",
    startedAt: "2026-08-14T10:00:00Z",
    localSeenAt: 0,
  };

  it("returns the generation kind when nothing is pending", () => {
    expect(resolveChatAttentionStatus(running, false)).toBe("running");
    expect(
      resolveChatAttentionStatus({ kind: "finished", startedAt: null }, false),
    ).toBe("finished");
    expect(
      resolveChatAttentionStatus({ kind: "error", startedAt: null }, false),
    ).toBe("error");
  });

  it("lets a pending confirmation outrank the generation state", () => {
    expect(resolveChatAttentionStatus(running, true)).toBe("action_required");
    expect(resolveChatAttentionStatus(undefined, true)).toBe("action_required");
  });

  it("treats absent and cleared statuses as no indicator", () => {
    expect(resolveChatAttentionStatus(undefined, false)).toBeNull();
    expect(
      resolveChatAttentionStatus({ kind: "cleared", startedAt: null }, false),
    ).toBeNull();
  });
});

describe("groupChatSessions", () => {
  it("returns no groups for an empty list in every mode", () => {
    for (const groupBy of ["date", "type", "unread", "none"] as const) {
      expect(groupChatSessions([], groupBy, deps())).toEqual([]);
    }
  });

  describe("date", () => {
    it("creates one bucket per calendar day, newest first, then Older", () => {
      const sessions = [
        session("today-1", localIso(2026, 7, 14, 15)),
        session("today-2", localIso(2026, 7, 14, 1)),
        session("yesterday", localIso(2026, 7, 13)),
        session("six-days", localIso(2026, 7, 8)),
        session("seven-days", localIso(2026, 7, 7)),
        session("ancient", localIso(2026, 0, 1)),
      ];

      const groups = groupChatSessions(sessions, "date", deps());

      expect(
        groups.map((group) => ({
          label: group.label,
          ids: group.sessions.map((s) => s.id),
        })),
      ).toEqual([
        { label: "Aug 14", ids: ["today-1", "today-2"] },
        { label: "Aug 13", ids: ["yesterday"] },
        { label: "Aug 8", ids: ["six-days"] },
        { label: "Older", ids: ["seven-days", "ancient"] },
      ]);
    });

    it("keeps a same-day boundary: 23:59 yesterday is not today", () => {
      const groups = groupChatSessions(
        [
          session("late", localIso(2026, 7, 13, 23)),
          session("early", localIso(2026, 7, 14, 0)),
        ],
        "date",
        deps(),
      );

      // Input order is preserved; the day split is by calendar day, not by
      // 24-hour distance.
      expect(groups.map((group) => group.label)).toEqual(["Aug 13", "Aug 14"]);
    });

    it("localizes the day label", () => {
      const groups = groupChatSessions(
        [session("a", localIso(2026, 7, 14))],
        "date",
        deps({ locale: "de" }),
      );

      expect(groups[0].label).toBe("14. Aug.");
    });

    it("omits the Older bucket when everything is recent", () => {
      const groups = groupChatSessions(
        [session("a", localIso(2026, 7, 14))],
        "date",
        deps(),
      );

      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBe("Aug 14");
    });

    it("puts sessions with unparsable dates into Older", () => {
      const groups = groupChatSessions(
        [session("bad", "not-a-date"), session("good", localIso(2026, 7, 14))],
        "date",
        deps(),
      );

      expect(groups.map((group) => group.label)).toEqual(["Aug 14", "Older"]);
      expect(groups[1].sessions.map((s) => s.id)).toEqual(["bad"]);
    });

    it("gives a slightly-future timestamp its own day bucket", () => {
      const groups = groupChatSessions(
        [session("future", localIso(2026, 7, 15, 0))],
        "date",
        deps(),
      );

      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBe("Aug 15");
    });
  });

  describe("type", () => {
    it("splits into Chats then Assistants and skips empty buckets", () => {
      const withBoth = groupChatSessions(
        [
          session("a1", localIso(2026, 7, 14), "assistant-1"),
          session("c1", localIso(2026, 7, 14)),
          session("a2", localIso(2026, 7, 13), "assistant-2"),
        ],
        "type",
        deps(),
      );

      expect(
        withBoth.map((group) => ({
          label: group.label,
          ids: group.sessions.map((s) => s.id),
        })),
      ).toEqual([
        { label: "Chats", ids: ["c1"] },
        { label: "Assistants", ids: ["a1", "a2"] },
      ]);

      const chatsOnly = groupChatSessions(
        [session("c1", localIso(2026, 7, 14))],
        "type",
        deps(),
      );
      expect(chatsOnly.map((group) => group.label)).toEqual(["Chats"]);
    });

    it("treats a null assistant id as a plain chat", () => {
      const groups = groupChatSessions(
        [{ ...session("c1", localIso(2026, 7, 14)), assistantId: null }],
        "type",
        deps(),
      );

      expect(groups.map((group) => group.label)).toEqual(["Chats"]);
    });
  });

  describe("unread", () => {
    it("splits by the injected attention classifier, Unread first", () => {
      const attention = new Set(["b"]);
      const groups = groupChatSessions(
        [
          session("a", localIso(2026, 7, 14)),
          session("b", localIso(2026, 7, 13)),
        ],
        "unread",
        deps({ needsAttention: (s) => attention.has(s.id) }),
      );

      expect(
        groups.map((group) => ({
          label: group.label,
          ids: group.sessions.map((s) => s.id),
        })),
      ).toEqual([
        { label: "Unread", ids: ["b"] },
        { label: "Other", ids: ["a"] },
      ]);
    });

    it("skips whichever bucket is empty", () => {
      const none = groupChatSessions(
        [session("a", localIso(2026, 7, 14))],
        "unread",
        deps(),
      );
      expect(none.map((group) => group.label)).toEqual(["Other"]);

      const all = groupChatSessions(
        [session("a", localIso(2026, 7, 14))],
        "unread",
        deps({ needsAttention: () => true }),
      );
      expect(all.map((group) => group.label)).toEqual(["Unread"]);
    });
  });

  describe("none", () => {
    it("returns a single unlabeled bucket with every session", () => {
      const sessions = [
        session("a", localIso(2026, 7, 14)),
        session("b", localIso(2026, 0, 1)),
      ];

      expect(groupChatSessions(sessions, "none", deps())).toEqual([
        { key: "all", label: null, sessions },
      ]);
    });
  });

  it("degrades an out-of-union groupBy to the single unlabeled bucket", () => {
    const sessions = [session("a", localIso(2026, 7, 14))];

    expect(
      groupChatSessions(sessions, "bogus" as ChatHistoryGroupBy, deps()),
    ).toEqual([{ key: "all", label: null, sessions }]);
  });
});
