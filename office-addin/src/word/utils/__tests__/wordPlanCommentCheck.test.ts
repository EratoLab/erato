import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installWordCommentHost,
  uninstallWordCommentHost,
} from "../../../test/mocks/word/commentHost";
import { V3C_COMMENTS } from "../../../test/mocks/word/commentPackages";
import {
  checkWordPlanComments,
  diffWordCommentStates,
  plannedWordCommentIds,
  readWordCommentStates,
} from "../wordPlanCommentCheck";

import type { WordCommentThreadState } from "../wordPlanCommentCheck";
import type { WordPlanCommentThread } from "@erato/frontend/word-review";

const thread = (
  id: string,
  extra: Partial<WordCommentThreadState> = {},
): WordCommentThreadState => ({
  id,
  resolved: false,
  author: `Author ${id}`,
  content: `Text ${id}`,
  replies: [],
  ...extra,
});
const BEFORE: WordCommentThreadState[] = [
  thread("1", {
    replies: [
      { id: "11", author: "Lee", content: "Agreed" },
      { id: "12", author: "Maya", content: "Done" },
    ],
  }),
  thread("2", { resolved: true }),
  thread("3"),
  thread("4"),
];
const planned2 = (thread: string, commentId: string | null) =>
  ({
    wId: thread,
    commentId,
    author: `Author ${thread}`,
    date: "",
    text: `Text ${thread}`,
    resolved: false,
    quote: "",
    replies: [],
  }) satisfies WordPlanCommentThread;

afterEach(() => {
  uninstallWordCommentHost();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("comment threads after a write", () => {
  it("reports exactly the planned removals", () => {
    expect(
      diffWordCommentStates(
        BEFORE,
        [BEFORE[0], BEFORE[1]],
        new Set(["3", "4"]),
      ),
    ).toEqual({ removed: 2, kept: 0, unexpected: 0 });
  });

  it("counts each thread changed without the plan once", () => {
    const after = [
      { ...BEFORE[0], replies: [BEFORE[0].replies![0]] },
      { ...BEFORE[1], resolved: false },
      thread("9", { content: "Unknown" }),
    ];
    expect(diffWordCommentStates(BEFORE, after, new Set(["3"]))).toEqual({
      removed: 1,
      kept: 0,
      unexpected: 4,
    });
    expect(
      diffWordCommentStates(
        BEFORE,
        [...BEFORE.slice(0, 3), { ...BEFORE[3], resolved: true }],
        new Set(),
      ).unexpected,
    ).toBe(1);
  });

  it("does not take a tracked cut and paste's second listing for a change or a removal (F-19)", () => {
    const copy = { ...BEFORE[2], id: "757279146", replies: [] };
    expect(diffWordCommentStates(BEFORE, [...BEFORE, copy], new Set())).toEqual(
      { removed: 0, kept: 0, unexpected: 0 },
    );
    const moved = [BEFORE[0], BEFORE[1], copy, BEFORE[3]];
    expect(diffWordCommentStates(BEFORE, moved, new Set())).toEqual({
      removed: 0,
      kept: 0,
      unexpected: 0,
    });
    expect(diffWordCommentStates(BEFORE, moved, new Set(["3"]))).toEqual({
      removed: 0,
      kept: 0,
      unexpected: 0,
    });
  });

  it("compares a moved thread's status and replies by author and text", () => {
    const copy = {
      ...BEFORE[0],
      id: "900",
      replies: [
        { ...BEFORE[0].replies![0], id: "901" },
        { ...BEFORE[0].replies![1], id: "902" },
      ],
    };
    const others = BEFORE.slice(1);
    expect(
      diffWordCommentStates(BEFORE, [copy, ...others], new Set()).unexpected,
    ).toBe(0);
    expect(
      diffWordCommentStates(
        BEFORE,
        [{ ...copy, resolved: true }, ...others],
        new Set(),
      ).unexpected,
    ).toBe(1);
    expect(
      diffWordCommentStates(
        BEFORE,
        [{ ...copy, replies: copy.replies.slice(0, 1) }, ...others],
        new Set(),
      ).unexpected,
    ).toBe(1);
  });

  it("takes the removal of a thread's twin for the planned one in a file without durableIds", () => {
    const twins = [
      thread("1", { content: "OK?" }),
      thread("2", { content: "OK?", author: "Author 1" }),
    ];
    const planned = plannedWordCommentIds(
      [{ ...planned2("2", null), author: "Author 1", text: "OK?" }],
      twins,
    );
    expect([...planned]).toEqual(["1"]);
    expect(diffWordCommentStates(twins, [twins[0]], planned)).toEqual({
      removed: 1,
      kept: 0,
      unexpected: 0,
    });
  });

  it("names planned threads Word kept, as inside a tracked deletion", () => {
    expect(diffWordCommentStates(BEFORE, BEFORE, new Set(["4"]))).toEqual({
      removed: 0,
      kept: 1,
      unexpected: 0,
    });
  });

  it("leaves replies it could not read out of the comparison", () => {
    expect(
      diffWordCommentStates(
        BEFORE,
        [{ ...BEFORE[0], replies: null }, ...BEFORE.slice(1)],
        new Set(),
      ).unexpected,
    ).toBe(0);
  });

  it("names planned threads by durableId, and by author and text in a file without one", () => {
    expect([
      ...plannedWordCommentIds(
        [planned2("3", "3"), planned2("4", null)],
        BEFORE,
      ),
    ]).toEqual(["3", "4"]);
    expect([...plannedWordCommentIds([planned2("2", "999")], BEFORE)]).toEqual([
      "2",
    ]);
  });

  it("reads again on Word for the web before it reports a change, and says when it could not read", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Office", {
      context: { diagnostics: { platform: "OfficeOnline" } },
    });
    const read = vi
      .fn<() => Promise<WordCommentThreadState[] | null>>()
      .mockResolvedValueOnce([BEFORE[1]])
      .mockResolvedValueOnce(BEFORE.slice(0, 2));
    const check = checkWordPlanComments(
      BEFORE,
      [planned2("3", "3"), planned2("4", "4")],
      read,
    );
    await vi.runAllTimersAsync();
    expect(await check).toEqual({ removed: 2, kept: 0, unexpected: 0 });
    expect(read).toHaveBeenCalledTimes(2);
    const late = vi
      .fn<() => Promise<WordCommentThreadState[] | null>>()
      .mockResolvedValueOnce(BEFORE)
      .mockResolvedValueOnce(BEFORE.slice(0, 3));
    const settled = checkWordPlanComments(BEFORE, [planned2("4", "4")], late);
    await vi.runAllTimersAsync();
    expect(await settled).toEqual({ removed: 1, kept: 0, unexpected: 0 });
    expect(await checkWordPlanComments(null, [], read)).toMatchObject({
      unverified: true,
    });
  });
});

describe("listing comment threads with the ERMAIN-948 reader", () => {
  it("lists ids, status and replies on Word PC", async () => {
    const host = installWordCommentHost({ host: "pc" });
    const states = await readWordCommentStates();
    const t1 = states?.find((s) => s.id === host.commentId("T1"));
    expect(t1).toMatchObject({
      resolved: false,
      author: V3C_COMMENTS.T1.author,
      replies: [{ id: host.commentId("R1a") }, { id: host.commentId("R1b") }],
    });
    expect(states?.find((s) => s.id === host.commentId("T2"))?.resolved).toBe(
      true,
    );
  });

  it("reads no comment range on Word for the web", async () => {
    const host = installWordCommentHost({ host: "web" });
    const states = await readWordCommentStates();
    expect(states?.map((s) => s.id).sort()).toEqual(
      host
        .listedIds()
        .map(String)
        .filter((id) => states?.some((s) => s.id === id))
        .sort(),
    );
    expect(states?.length).toBeGreaterThan(10);
    expect(host.rangesRead()).toEqual([]);
    expect(host.calls()).not.toContain("comment.getRange");
  });
});
