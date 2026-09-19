import { describe, expect, it } from "vitest";

import { serverAttachKey } from "../serverAttachKey";

describe("serverAttachKey", () => {
  it("collapses the three producers' spellings of one instant onto one key", () => {
    // 1. the poll snapshot: server clock, microsecond fraction, numeric offset
    const poll = serverAttachKey("c", "2026-09-19T12:00:00.123456+00:00");
    // 2. the 409 body: truncated by `to_char` to the whole second, `Z`
    const refusal = serverAttachKey("c", "2026-09-19T12:00:00Z");
    // 3. a local seed landing just under the next second
    const local = serverAttachKey("c", "2026-09-19T12:00:00.999Z");

    expect(poll).toBe(refusal);
    expect(poll).toBe(local);
  });

  it("separates generations that started in different seconds", () => {
    expect(serverAttachKey("c", "2026-09-19T12:00:00Z")).not.toBe(
      serverAttachKey("c", "2026-09-19T12:00:01Z"),
    );
  });

  it("separates chats that started in the same second", () => {
    expect(serverAttachKey("a", "2026-09-19T12:00:00Z")).not.toBe(
      serverAttachKey("b", "2026-09-19T12:00:00Z"),
    );
  });

  it("falls back to the honest ':enter' key when no start time is readable", () => {
    expect(serverAttachKey("c")).toBe("c:enter");
    expect(serverAttachKey("c", null)).toBe("c:enter");
    expect(serverAttachKey("c", "")).toBe("c:enter");
    // `GenerationRunningError.started_at` is typed `?: null | undefined`, so
    // this is the shape a 409 body actually hands us.
    expect(serverAttachKey("c", "not a timestamp")).toBe("c:enter");
  });
});
