import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_VIEW_HEIGHT } from "./hostContext";
import {
  forgetViewHeight,
  rememberViewHeight,
  rememberedViewHeight,
  resetViewHeightsForTests,
} from "./viewHeights";

const view = { serverId: "charts", uri: "ui://charts/bar" };

describe("view heights", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    resetViewHeightsForTests();
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
    // Nor for a call of another server or view with the same id: providers
    // reuse tool call ids.
    expect(
      rememberedViewHeight({ ...view, serverId: "maps", callId: "call-1" }),
    ).toBeUndefined();
    expect(
      rememberedViewHeight({
        ...view,
        uri: "ui://charts/pie",
        callId: "call-1",
      }),
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

    resetViewHeightsForTests();
    expect(rememberedViewHeight({ ...view, callId: "call-1" })).toBe(320);

    window.sessionStorage.clear();
    resetViewHeightsForTests();
    expect(rememberedViewHeight({ ...view, callId: "call-1" })).toBeUndefined();
  });

  it("forgets a view that did not show, by its call and its view", () => {
    rememberViewHeight({ ...view, callId: "call-1", width: 640 }, 320);
    forgetViewHeight({ ...view, callId: "call-1", width: 640 });

    expect(rememberedViewHeight({ ...view, callId: "call-1" })).toBeUndefined();
    expect(
      rememberedViewHeight({ ...view, callId: "call-2", width: 640 }),
    ).toBeUndefined();
    resetViewHeightsForTests();
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
        ['["call","charts","ui://charts/bar","call-1"]', "320"],
        ['["call","charts","ui://charts/bar","call-2"]', 10_000_000],
        ['["call","charts","ui://charts/bar","call-3"]', 200],
        "nonsense",
      ]),
    );
    resetViewHeightsForTests();
    expect(rememberedViewHeight({ ...view, callId: "call-1" })).toBeUndefined();
    expect(rememberedViewHeight({ ...view, callId: "call-2" })).toBeUndefined();
    expect(rememberedViewHeight({ ...view, callId: "call-3" })).toBe(200);
  });

  it("drops the heights of the views seen least recently once it holds many", () => {
    const heightOf = (index: number) =>
      rememberedViewHeight({ ...view, callId: `call-${index}` });
    for (let index = 0; index < 250; index += 1) {
      rememberViewHeight({ ...view, callId: `call-${index}` }, 100 + index);
    }
    expect(heightOf(49)).toBeUndefined();
    expect(heightOf(50)).toBe(150);

    // Seen again, at another height and at the same one: now the newest, also
    // after a reload.
    rememberViewHeight({ ...view, callId: "call-60" }, 99);
    rememberViewHeight({ ...view, callId: "call-80" }, 180);
    resetViewHeightsForTests();
    for (let index = 250; index < 280; index += 1) {
      rememberViewHeight({ ...view, callId: `call-${index}` }, 100 + index);
    }

    resetViewHeightsForTests();
    expect(heightOf(0)).toBeUndefined();
    expect(heightOf(59)).toBeUndefined();
    expect(heightOf(60)).toBe(99);
    expect(heightOf(61)).toBeUndefined();
    expect(heightOf(79)).toBeUndefined();
    expect(heightOf(80)).toBe(180);
    expect(heightOf(81)).toBeUndefined();
    expect(heightOf(82)).toBe(182);
    expect(heightOf(279)).toBe(379);
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
