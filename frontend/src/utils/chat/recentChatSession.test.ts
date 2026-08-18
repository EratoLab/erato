import { i18n, type Messages } from "@lingui/core";
import { beforeAll, describe, expect, it } from "vitest";

import enMessages from "@/locales/en/messages.json";
import {
  isDelegatedRun,
  mapRecentChatToSession,
} from "@/utils/chat/recentChatSession";
import { groupChatSessions } from "@/utils/chatHistoryGrouping";

import type { RecentChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

beforeAll(() => {
  i18n.load("en", enMessages.messages as unknown as Messages);
  i18n.activate("en");
});

const recentChat = (id: string, assistantId?: string): RecentChat => ({
  id,
  title_resolved: `Title of ${id}`,
  can_edit: true,
  file_uploads: [],
  last_message_at: "2026-08-14T10:00:00.000Z",
  is_pinned: false,
  assistant_id: assistantId,
});

describe("mapRecentChatToSession", () => {
  it("keeps the assistant id for type grouping and assistant-aware links", () => {
    expect(
      mapRecentChatToSession(recentChat("c1")).assistantId,
    ).toBeUndefined();
    expect(
      mapRecentChatToSession(recentChat("a1", "assistant-1")).assistantId,
    ).toBe("assistant-1");
  });

  it("buckets a mapped assistant chat under Assistants when grouping by type", () => {
    const groups = groupChatSessions(
      [recentChat("c1"), recentChat("a1", "assistant-1")].map(
        mapRecentChatToSession,
      ),
      "type",
      {
        now: new Date(2026, 7, 14, 15),
        locale: "en",
        needsAttention: () => false,
      },
    );

    expect(
      groups.map((group) => ({
        label: group.label,
        ids: group.sessions.map((session) => session.id),
      })),
    ).toEqual([
      { label: "Chats", ids: ["c1"] },
      { label: "Assistants", ids: ["a1"] },
    ]);
  });

  it("maps the listed fields onto the session row model", () => {
    const session = mapRecentChatToSession({
      ...recentChat("c1"),
      title_by_summary: "Summary title",
      is_pinned: true,
    });

    expect(session).toMatchObject({
      id: "c1",
      title: "Title of c1",
      titleResolved: "Title of c1",
      titleBySummary: "Summary title",
      titleByUserProvided: null,
      canEdit: true,
      isPinned: true,
      updatedAt: "2026-08-14T10:00:00.000Z",
    });
    expect(session.metadata?.fileCount).toBe(0);
  });

  it("carries the provenance envelope onto the session row model", () => {
    const session = mapRecentChatToSession({
      ...recentChat("c1"),
      provenance_kind: "delegation",
      origin_chat_id: "origin-1",
      origin_chat_title: "Quarterly planning",
    });

    expect(session).toMatchObject({
      provenanceKind: "delegation",
      originChatId: "origin-1",
      originChatTitle: "Quarterly planning",
    });
  });
});

describe("isDelegatedRun", () => {
  it("recognises only the delegation provenance kind", () => {
    expect(isDelegatedRun({ provenance_kind: "delegation" })).toBe(true);
    expect(isDelegatedRun({ provenance_kind: "handoff_branch" })).toBe(false);
    expect(isDelegatedRun({ provenance_kind: "handoff_move" })).toBe(false);
    expect(isDelegatedRun({})).toBe(false);
  });
});
