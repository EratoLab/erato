import { describe, expect, it } from "vitest";

import { FreshCompletionTracker } from "../freshCompletionTracker";

import type { Message } from "@erato/frontend/library";

function message(
  id: string,
  role: "user" | "assistant",
  status: Message["status"],
): Message {
  return {
    id,
    role,
    status,
    content: [],
    createdAt: "2026-06-09T00:00:00Z",
  };
}

describe("FreshCompletionTracker", () => {
  it("treats the initial snapshot as history — nothing is fresh", () => {
    const tracker = new FreshCompletionTracker();
    expect(
      tracker.observe({ a: message("a", "assistant", "complete") }, ["a"]),
    ).toEqual([]);
  });

  it("marks a sending → complete transition as fresh", () => {
    const tracker = new FreshCompletionTracker();
    tracker.observe({ a: message("a", "assistant", "sending") }, ["a"]);
    expect(
      tracker.observe({ a: message("a", "assistant", "complete") }, ["a"]),
    ).toEqual(["a"]);
  });

  it("reports a fresh id only once", () => {
    const tracker = new FreshCompletionTracker();
    tracker.observe({ a: message("a", "assistant", "sending") }, ["a"]);
    tracker.observe({ a: message("a", "assistant", "complete") }, ["a"]);
    expect(
      tracker.observe({ a: message("a", "assistant", "complete") }, ["a"]),
    ).toEqual([]);
  });

  it("ignores messages that APPEAR already complete mid-session (refetch)", () => {
    const tracker = new FreshCompletionTracker();
    tracker.observe({}, []);
    expect(
      tracker.observe({ a: message("a", "assistant", "complete") }, ["a"]),
    ).toEqual([]);
  });

  it("ignores user messages and error completions", () => {
    const tracker = new FreshCompletionTracker();
    tracker.observe(
      {
        u: message("u", "user", "sending"),
        a: message("a", "assistant", "sending"),
      },
      ["u", "a"],
    );
    expect(
      tracker.observe(
        {
          u: message("u", "user", "complete"),
          a: message("a", "assistant", "error"),
        },
        ["u", "a"],
      ),
    ).toEqual([]);
  });

  it("handles multiple streams completing across snapshots", () => {
    const tracker = new FreshCompletionTracker();
    tracker.observe({ a: message("a", "assistant", "complete") }, ["a"]);
    tracker.observe(
      {
        a: message("a", "assistant", "complete"),
        b: message("b", "assistant", "sending"),
      },
      ["a", "b"],
    );
    expect(
      tracker.observe(
        {
          a: message("a", "assistant", "complete"),
          b: message("b", "assistant", "complete"),
        },
        ["a", "b"],
      ),
    ).toEqual(["b"]);
  });
});
