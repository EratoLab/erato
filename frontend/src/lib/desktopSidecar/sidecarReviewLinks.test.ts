import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  askForReviewAgain,
  forgetReview,
  isTaskReview,
  markReviewEnded,
  markTaskReviewEnded,
  rememberReview,
  reviewHasEnded,
  reviewLink,
  reviewLinkKey,
  useChatsInReview,
  useSidecarReviewLinks,
  waitsToAskAgain,
} from "./sidecarReviewLinks";

const STORAGE_KEY = "erato.desktopSidecar.reviewLinks.v1";
const key = reviewLinkKey("message-1", "call-1");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  useSidecarReviewLinks.setState({ links: {} });
});

describe("sidecar review links", () => {
  it("names the chats a review open in this browser waits on", () => {
    rememberReview(key, "handle-1", ["task-chat", "origin-chat"]);
    const { result } = renderHook(() => useChatsInReview());
    expect([...result.current].sort()).toEqual(["origin-chat", "task-chat"]);
  });

  it("keeps naming them once the review has ended, until the user asks again", () => {
    rememberReview(key, "handle-1", ["task-chat", "origin-chat"]);
    const { result, rerender } = renderHook(() => useChatsInReview());

    markReviewEnded(key);
    rerender();
    expect(reviewLink(key)).toMatchObject({
      state: "ended",
      chatIds: ["task-chat", "origin-chat"],
    });
    expect([...result.current].sort()).toEqual(["origin-chat", "task-chat"]);

    askForReviewAgain(key);
    rerender();
    expect(result.current.size).toBe(0);
  });

  it("keeps a task's ended review for its parent's item, with no chat waiting on it", () => {
    rememberReview(key, "handle-1", ["task-chat", "origin-chat"], {
      task: true,
    });
    const { result, rerender } = renderHook(() => useChatsInReview());

    markTaskReviewEnded(key);
    rerender();
    expect(reviewLink(key)).toEqual({
      state: "ended",
      task: true,
      at: expect.any(Number),
    });
    expect(isTaskReview(reviewLink(key))).toBe(true);
    expect(result.current.size).toBe(0);
  });

  it("keeps a task's review a task's through every way it is marked ended", () => {
    rememberReview(key, "handle-1", ["task-chat", "origin-chat"], {
      task: true,
    });
    expect(reviewLink(key)).toMatchObject({ state: "open", task: true });
    expect(isTaskReview(reviewLink(key))).toBe(true);
    // Open found the review ended before the task's run did.
    markReviewEnded(key);
    expect(reviewLink(key)).toEqual({
      state: "ended",
      chatIds: ["task-chat", "origin-chat"],
      task: true,
      at: expect.any(Number),
    });
    // The user's own call is no task's.
    const own = reviewLinkKey("message-2", "call-2");
    rememberReview(own, "handle-2", ["chat-1"]);
    markReviewEnded(own);
    expect(reviewLink(own)).not.toHaveProperty("task");
    expect(isTaskReview(reviewLink(own))).toBe(false);
  });

  it("holds only the user's own call while its review waits to be asked again", () => {
    const own = {
      message_id: "message-1",
      tool_call_id: "call-1",
    } as const;
    const task = {
      ...own,
      lineage: {
        owner_chat_id: "origin-chat",
        owner_message_id: "origin-message",
        requesting_chat_id: "task-chat",
        requesting_message_id: "message-1",
      },
    };
    rememberReview(key, "handle-1");
    expect(waitsToAskAgain(own)).toBe(false);
    markReviewEnded(key);
    expect(waitsToAskAgain(own)).toBe(true);
    // A task's call ends with its review, so its next run says so.
    expect(waitsToAskAgain(task)).toBe(false);
  });

  it("keeps a call's job beyond the page that opened it, with ids only", () => {
    rememberReview(key, "handle-1");
    expect(reviewLink(key)).toMatchObject({
      state: "open",
      handle: "handle-1",
    });
    const raw = localStorage.getItem(STORAGE_KEY) ?? "";
    expect(JSON.parse(raw)).toEqual({
      [key]: { state: "open", handle: "handle-1", at: expect.any(Number) },
    });
  });

  it("scopes a tool call id to its message", () => {
    expect(reviewLinkKey("message-2", "call-1")).not.toBe(key);
  });

  it("follows the call through a review that ends, is asked again and is forgotten", () => {
    rememberReview(key, "handle-1");
    expect(reviewHasEnded("message-1", "call-1")).toBe(false);
    markReviewEnded(key);
    expect(reviewHasEnded("message-1", "call-1")).toBe(true);
    expect(reviewLink(key)).toMatchObject({ state: "ended" });
    askForReviewAgain(key);
    expect(reviewLink(key)).toMatchObject({ state: "asking" });
    expect(reviewHasEnded("message-1", "call-1")).toBe(false);
    forgetReview(key);
    expect(reviewLink(key)).toBeUndefined();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "")).toEqual({});
  });

  it("drops links past the longest a parked call can wait", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
    rememberReview(key, "handle-1");
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    rememberReview(reviewLinkKey("message-2", "call-2"), "handle-2");
    expect(reviewLink(key)).toBeUndefined();
    expect(reviewLink(reviewLinkKey("message-2", "call-2"))).toBeDefined();
  });

  it("sees a link another tab wrote", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        [key]: { state: "ended", at: Date.now(), chatIds: ["chat-1"] },
        tasks: { state: "ended", at: Date.now(), task: true },
        broken: { state: "open" },
        badChats: { state: "ended", at: Date.now(), chatIds: "chat-1" },
        badTask: { state: "open", handle: "h", at: Date.now(), task: "yes" },
      }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    expect(reviewLink(key)).toMatchObject({
      state: "ended",
      chatIds: ["chat-1"],
    });
    expect(isTaskReview(reviewLink("tasks"))).toBe(true);
    expect(reviewLink("broken")).toBeUndefined();
    expect(reviewLink("badChats")).toBeUndefined();
    expect(reviewLink("badTask")).toBeUndefined();
  });

  it("keeps working for this page where storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Blocked.");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Blocked.");
    });
    rememberReview(key, "handle-1");
    expect(reviewLink(key)).toMatchObject({ state: "open" });
  });
});
