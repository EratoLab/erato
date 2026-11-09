import { afterEach, describe, expect, it, vi } from "vitest";

import {
  askForReviewAgain,
  forgetReview,
  markReviewEnded,
  rememberReview,
  reviewHasEnded,
  reviewLink,
  reviewLinkKey,
  useSidecarReviewLinks,
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
        [key]: { state: "ended", at: Date.now() },
        broken: { state: "open" },
      }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    expect(reviewLink(key)).toMatchObject({ state: "ended" });
    expect(reviewLink("broken")).toBeUndefined();
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
