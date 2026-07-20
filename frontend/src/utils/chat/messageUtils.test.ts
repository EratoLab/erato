import { describe, it, expect } from "vitest";

import { collectSupersededMessageIds } from "./messageUtils";

import type { Message } from "@/types/chat";

const message = (
  id: string,
  role: Message["role"],
  createdAt: string,
): Message => ({
  id,
  content: [{ content_type: "text", text: id }],
  role,
  createdAt,
  status: "complete",
});

const conversation = (): Record<string, Message> => ({
  u1: message("u1", "user", "2026-02-20T10:00:00.000Z"),
  a1: message("a1", "assistant", "2026-02-20T10:01:00.000Z"),
  u2: message("u2", "user", "2026-02-20T10:02:00.000Z"),
  a2: message("a2", "assistant", "2026-02-20T10:03:00.000Z"),
  u3: message("u3", "user", "2026-02-20T10:04:00.000Z"),
  a3: message("a3", "assistant", "2026-02-20T10:05:00.000Z"),
});

describe("collectSupersededMessageIds", () => {
  it("returns the edited user message and every later turn", () => {
    expect(collectSupersededMessageIds(conversation(), "u2")).toEqual([
      "u2",
      "a2",
      "u3",
      "a3",
    ]);
  });

  it("returns the regenerated assistant and every later turn", () => {
    expect(collectSupersededMessageIds(conversation(), "a2")).toEqual([
      "a2",
      "u3",
      "a3",
    ]);
  });

  it("orders by createdAt rather than insertion order", () => {
    const outOfOrder: Record<string, Message> = {
      a3: message("a3", "assistant", "2026-02-20T10:05:00.000Z"),
      u2: message("u2", "user", "2026-02-20T10:02:00.000Z"),
      u1: message("u1", "user", "2026-02-20T10:00:00.000Z"),
    };

    expect(collectSupersededMessageIds(outOfOrder, "u2")).toEqual(["u2", "a3"]);
  });

  it("falls back to the anchor alone when it is not in the list", () => {
    expect(
      collectSupersededMessageIds(conversation(), "temp-user-999"),
    ).toEqual(["temp-user-999"]);
  });
});
