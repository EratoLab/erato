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
  });

  afterEach(() => {
    vi.useRealTimers();
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
    document.body.removeAttribute("style");
  });

  it("gives an opaque colour as #rrggbb", async () => {
    const { pageBackground } = await load();
    document.body.style.background = "rgb(249, 250, 251)";
    expect(pageBackground()).toBe("#f9fafb");
  });

  it("gives nothing for a see-through background", async () => {
    const { pageBackground } = await load();
    expect(pageBackground()).toBeUndefined();
    document.body.style.background = "rgba(0, 0, 0, 0.5)";
    expect(pageBackground()).toBeUndefined();
  });
});
