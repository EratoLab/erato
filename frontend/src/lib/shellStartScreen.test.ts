import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installHostShell, removeHostShell } from "@/test/hostShellStub";

type Module = typeof import("./shellStartScreen");

/** A fresh module per test: it reports once per page load. */
async function load(): Promise<Module> {
  vi.resetModules();
  return import("./shellStartScreen");
}

/** Lets promises settle and two animation frames pass. */
async function frames() {
  await vi.advanceTimersByTimeAsync(50);
}

describe("the start screen report", () => {
  const realFetch = window.fetch;
  let answer: (() => void)[];

  beforeEach(() => {
    vi.useFakeTimers();
    answer = [];
    // Each request stays open until the test answers it.
    window.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer.push(() => resolve(new Response("{}")));
        }),
    );
    document.body.style.background = "rgb(17, 24, 39)";
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    removeHostShell();
    window.fetch = realFetch;
    document.body.removeAttribute("style");
    document.body.replaceChildren();
  });

  it("asks nothing of a shell that does not cover the start", async () => {
    const request = installHostShell({ share: 1 });
    const { announceStartScreenReport, reportDrawnWhenSettled } = await load();
    const before = window.fetch;
    announceStartScreenReport();
    reportDrawnWhenSettled();
    await frames();
    expect(request).not.toHaveBeenCalled();
    expect(window.fetch).toBe(before);
  });

  it("announces itself to a shell that covers the start", async () => {
    const request = installHostShell({ startScreen: 1 });
    const { announceStartScreenReport } = await load();
    announceStartScreenReport();
    expect(request).toHaveBeenCalledWith("startScreen.wait");
  });

  it("reports once the requests have answered, with the page's colour, once", async () => {
    const request = installHostShell({ startScreen: 1 });
    const { announceStartScreenReport, reportDrawnWhenSettled } = await load();
    const before = window.fetch;
    announceStartScreenReport();
    request.mockClear();
    void window.fetch("/api/v1beta/me/recent_chats");
    void window.fetch("/custom-theme/theme.json");

    reportDrawnWhenSettled();
    await frames();
    answer[0]();
    await frames();
    expect(request).not.toHaveBeenCalled();

    answer[1]();
    await frames();
    expect(request).toHaveBeenCalledWith("startScreen.ready", {
      background: "#111827",
    });
    expect(window.fetch).toBe(before);

    reportDrawnWhenSettled();
    await frames();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("waits for an image on its way", async () => {
    const request = installHostShell({ startScreen: 1 });
    const { reportDrawnWhenSettled } = await load();
    const logo = document.createElement("img");
    Object.defineProperty(logo, "complete", {
      configurable: true,
      value: false,
    });
    document.body.append(logo);

    reportDrawnWhenSettled();
    await frames();
    expect(request).not.toHaveBeenCalled();

    Object.defineProperty(logo, "complete", { value: true });
    logo.dispatchEvent(new Event("load"));
    await frames();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("reports at the limit while a request is still open", async () => {
    const request = installHostShell({ startScreen: 1 });
    const {
      announceStartScreenReport,
      reportDrawnWhenSettled,
      SETTLE_LIMIT_MS,
    } = await load();
    announceStartScreenReport();
    request.mockClear();
    void window.fetch("/api/v1beta/stream");

    reportDrawnWhenSettled();
    await vi.advanceTimersByTimeAsync(SETTLE_LIMIT_MS - 100);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("tells a shell of version 1 nothing new", async () => {
    const request = installHostShell({ startScreen: 1 });
    const { reportDrawnWhenSettled, setStartMayResume } = await load();
    setStartMayResume(true);
    reportDrawnWhenSettled();
    await frames();
    setStartMayResume(false);
    await frames();
    expect(request.mock.calls).toEqual([
      ["startScreen.ready", { background: "#111827" }],
    ]);
  });

  it("tells a shell that keeps pages whether a start may resume, and again when that changes", async () => {
    const request = installHostShell({ startScreen: 2 });
    const { reportDrawnWhenSettled, setStartMayResume } = await load();
    setStartMayResume(false);
    setStartMayResume(true);
    await frames();
    expect(request).not.toHaveBeenCalled();

    reportDrawnWhenSettled();
    await frames();
    setStartMayResume(true);
    setStartMayResume(false);
    setStartMayResume(false);
    await frames();
    expect(request.mock.calls).toEqual([
      ["startScreen.ready", { background: "#111827", resume: true }],
      ["startScreen.ready", { background: "#111827", resume: false }],
    ]);
  });

  it("does not report for a layout that went away", async () => {
    const request = installHostShell({ startScreen: 1 });
    const { reportDrawnWhenSettled } = await load();
    const stop = reportDrawnWhenSettled();
    stop();
    await frames();
    expect(request).not.toHaveBeenCalled();

    reportDrawnWhenSettled();
    await frames();
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("pageBackground", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.removeAttribute("style");
  });

  /** A canvas whose one pixel takes the colours a browser would paint. */
  function paintLikeABrowser(pixels: Record<string, number[]>) {
    let fill = "";
    const context = {
      set fillStyle(value: string) {
        if (value in pixels || value.startsWith("rgba(0, 0, 0, 0)")) {
          fill = value;
        }
      },
      fillRect: () => {},
      getImageData: () => ({ data: pixels[fill] ?? [0, 0, 0, 0] }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
  }

  it("turns any colour form into #rrggbb through the canvas", async () => {
    const { toHex } = await load();
    paintLikeABrowser({
      "oklch(0.97 0.01 90)": [247, 246, 243, 255],
      "color(srgb 0.04 0.18 0.26)": [11, 47, 66, 255],
      "lab(12 -2 -14 / 0.5)": [20, 30, 40, 128],
    });
    expect(toHex("oklch(0.97 0.01 90)")).toBe("#f7f6f3");
    expect(toHex("color(srgb 0.04 0.18 0.26)")).toBe("#0b2f42");
    expect(toHex("lab(12 -2 -14 / 0.5)")).toBeUndefined();
    expect(toHex("not a colour")).toBeUndefined();
  });

  it("reads rgb() with fractional channels without a canvas", async () => {
    const { toHex } = await load();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(toHex("rgb(249.4, 250.6, 251)")).toBe("#f9fbfb");
    expect(toHex("rgb(17 24 39 / 100%)")).toBe("#111827");
    expect(toHex("rgba(0, 0, 0, 0.5)")).toBeUndefined();
  });

  it("gives the body's colour, and nothing under a gradient", async () => {
    const { pageBackground } = await load();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    document.body.style.backgroundColor = "rgb(249, 250, 251)";
    expect(pageBackground()).toBe("#f9fafb");
    // jsdom does not compute gradients; a browser gives this.
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      backgroundColor: "rgb(249, 250, 251)",
      backgroundImage: "linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))",
    } as CSSStyleDeclaration);
    expect(pageBackground()).toBeUndefined();
  });

  it("gives nothing for a see-through background", async () => {
    const { pageBackground } = await load();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(pageBackground()).toBeUndefined();
  });
});
