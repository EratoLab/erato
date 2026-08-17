import { describe, expect, it } from "vitest";

import {
  NEW_CHAT_LOCAL_ANSWER_KEY,
  addSidecarLocalAnswer,
  dismissSidecarLocalAnswer,
  parseSidecarLocalAnswers,
  rekeySidecarLocalAnswers,
  removeMatchingSidecarLocalAnswer,
  sidecarLocalAnswersForChat,
  type SidecarLocalAnswer,
} from "./localAnswers";

const entry = (
  overrides: Partial<SidecarLocalAnswer> = {},
): SidecarLocalAnswer => ({
  id: "answer-1",
  chatKey: "chat-1",
  deniedAt: "2026-08-04T10:00:00.000Z",
  query: "Q3 offer",
  summary: "Three emails mention the Q3 offer.",
  summaryModel: "qwen3:14b",
  hitLines: ["Angebot Q3 — Janet Schorr"],
  ...overrides,
});

describe("sidecar local answers", () => {
  it("replaces an earlier answer for the same chat and query", () => {
    const first = addSidecarLocalAnswer([], entry());
    const second = addSidecarLocalAnswer(
      first,
      entry({ id: "answer-2", summary: "Updated." }),
    );
    expect(second).toHaveLength(1);
    expect(second[0].summary).toBe("Updated.");
  });

  it("keeps different queries and caps them per chat", () => {
    let entries: SidecarLocalAnswer[] = [];
    for (const index of [1, 2, 3, 4]) {
      entries = addSidecarLocalAnswer(
        entries,
        entry({ id: `answer-${index}`, query: `query-${index}` }),
      );
    }
    expect(entries).toHaveLength(3);
    expect(entries.map((item) => item.query)).toEqual([
      "query-2",
      "query-3",
      "query-4",
    ]);
  });

  it("ignores an answer with no content", () => {
    expect(addSidecarLocalAnswer([], entry({ summary: "  " }))).toHaveLength(0);
  });

  it("drops the entry when the same search is later shared", () => {
    const entries = addSidecarLocalAnswer([], entry());
    expect(
      removeMatchingSidecarLocalAnswer(entries, "chat-1", "Q3 offer"),
    ).toHaveLength(0);
    expect(
      removeMatchingSidecarLocalAnswer(entries, "chat-1", "other"),
    ).toHaveLength(1);
  });

  it("shows only the current chat's answers, newest first", () => {
    const entries = [
      entry({ id: "a", query: "first" }),
      entry({ id: "b", query: "second" }),
      entry({ id: "c", chatKey: "chat-2" }),
    ];
    expect(
      sidecarLocalAnswersForChat(entries, "chat-1").map((item) => item.id),
    ).toEqual(["b", "a"]);
    expect(sidecarLocalAnswersForChat(entries, null)).toEqual([]);
  });

  it("rekeys new-chat answers once the chat has a server id", () => {
    const entries = [entry({ chatKey: NEW_CHAT_LOCAL_ANSWER_KEY })];
    expect(rekeySidecarLocalAnswers(entries, "chat-9")[0].chatKey).toBe(
      "chat-9",
    );
  });

  it("drops sentinel-keyed and expired entries when reading storage", () => {
    const nowMs = Date.parse("2026-08-04T12:00:00.000Z");
    const parsed = parseSidecarLocalAnswers(
      [
        entry(),
        entry({ id: "sentinel", chatKey: NEW_CHAT_LOCAL_ANSWER_KEY }),
        entry({ id: "old", deniedAt: "2026-01-01T00:00:00.000Z" }),
        { nonsense: true },
      ],
      nowMs,
    );
    expect(parsed?.map((item) => item.id)).toEqual(["answer-1"]);
    expect(parseSidecarLocalAnswers("not an array")).toBeNull();
  });

  it("dismisses by id", () => {
    const entries = addSidecarLocalAnswer([], entry());
    expect(dismissSidecarLocalAnswer(entries, "answer-1")).toHaveLength(0);
  });
});
