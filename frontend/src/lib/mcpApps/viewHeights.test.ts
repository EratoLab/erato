import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_VIEW_HEIGHT } from "./hostContext";
import {
  forgetViewHeight,
  rememberViewHeight,
  rememberedViewHeight,
  resetViewHeights,
} from "./viewHeights";

const view = { serverId: "charts", uri: "ui://charts/bar" };

describe("view heights", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    resetViewHeights();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("knows a call's height, and for another call the view's at about the same width", () => {
    rememberViewHeight({ ...view, callId: "call-1", width: 640 }, 320);

    expect(rememberedViewHeight({ ...view, callId: "call-1" })).toBe(320);
    // Another call of the view, at a width that differs a little.
    expect(
      rememberedViewHeight({ ...view, callId: "call-2", width: 650 }),
    ).toBe(320);
    // Not at another width, nor for another view or server.
    expect(
      rememberedViewHeight({ ...view, callId: "call-2", width: 480 }),
    ).toBeUndefined();
    expect(rememberedViewHeight({ ...view, callId: "call-2" })).toBeUndefined();
    expect(
      rememberedViewHeight({
        serverId: "charts",
        uri: "ui://charts/pie",
        width: 640,
      }),
    ).toBeUndefined();
    expect(
      rememberedViewHeight({ ...view, serverId: "maps", width: 640 }),
    ).toBeUndefined();
  });

  it("prefers the call's own height to the view's", () => {
    rememberViewHeight({ ...view, callId: "call-1", width: 640 }, 320);
    rememberViewHeight({ ...view, callId: "call-2", width: 640 }, 500);

    expect(
      rememberedViewHeight({ ...view, callId: "call-1", width: 640 }),
    ).toBe(320);
    expect(
      rememberedViewHeight({ ...view, callId: "call-3", width: 640 }),
    ).toBe(500);
  });

  it("keeps the heights in the tab's session storage, for a reload", () => {
    rememberViewHeight({ ...view, callId: "call-1", width: 640 }, 320);

    resetViewHeights();
    expect(rememberedViewHeight({ ...view, callId: "call-1" })).toBe(320);

    window.sessionStorage.clear();
    resetViewHeights();
    expect(rememberedViewHeight({ ...view, callId: "call-1" })).toBeUndefined();
  });

  it("forgets a view that did not show, by its call and its view", () => {
    rememberViewHeight({ ...view, callId: "call-1", width: 640 }, 320);
    forgetViewHeight({ ...view, callId: "call-1", width: 640 });

    expect(rememberedViewHeight({ ...view, callId: "call-1" })).toBeUndefined();
    expect(
      rememberedViewHeight({ ...view, callId: "call-2", width: 640 }),
    ).toBeUndefined();
    resetViewHeights();
    expect(rememberedViewHeight({ ...view, callId: "call-1" })).toBeUndefined();
  });

  it("keeps only heights a view can have", () => {
    for (const height of [0, -1, Number.NaN, MAX_VIEW_HEIGHT + 1]) {
      rememberViewHeight({ ...view, callId: "call-1" }, height);
    }
    expect(rememberedViewHeight({ ...view, callId: "call-1" })).toBeUndefined();

    window.sessionStorage.setItem(
      "erato.mcpApps.viewHeights",
      JSON.stringify([
        ['["call","call-1"]', "320"],
        ['["call","call-2"]', 10_000_000],
        ['["call","call-3"]', 200],
        "nonsense",
      ]),
    );
    resetViewHeights();
    expect(rememberedViewHeight({ ...view, callId: "call-1" })).toBeUndefined();
    expect(rememberedViewHeight({ ...view, callId: "call-2" })).toBeUndefined();
    expect(rememberedViewHeight({ ...view, callId: "call-3" })).toBe(200);
  });

  it("drops the oldest heights first once it holds many", () => {
    for (let index = 0; index < 250; index += 1) {
      rememberViewHeight({ ...view, callId: `call-${index}` }, 100 + index);
    }
    // Seen again, so it is among the newest.
    rememberViewHeight({ ...view, callId: "call-10" }, 99);

    resetViewHeights();
    expect(rememberedViewHeight({ ...view, callId: "call-0" })).toBeUndefined();
    expect(
      rememberedViewHeight({ ...view, callId: "call-49" }),
    ).toBeUndefined();
    expect(rememberedViewHeight({ ...view, callId: "call-10" })).toBe(99);
    expect(rememberedViewHeight({ ...view, callId: "call-249" })).toBe(349);
  });

  it("works in memory when session storage cannot be read or written", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    expect(rememberedViewHeight({ ...view, callId: "call-1" })).toBeUndefined();
    rememberViewHeight({ ...view, callId: "call-1" }, 320);
    expect(rememberedViewHeight({ ...view, callId: "call-1" })).toBe(320);
    forgetViewHeight({ ...view, callId: "call-1" });
    expect(rememberedViewHeight({ ...view, callId: "call-1" })).toBeUndefined();
  });
});
