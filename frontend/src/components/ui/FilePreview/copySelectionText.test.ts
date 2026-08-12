import { afterEach, describe, expect, it, vi } from "vitest";

import { copyTextToClipboard } from "./copySelectionText";

const setClipboard = (writeText: () => Promise<void>) => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("copyTextToClipboard", () => {
  it("uses the Clipboard API when it is available", async () => {
    const writeText = vi.fn(async () => undefined);
    setClipboard(writeText);

    await expect(copyTextToClipboard("selected text")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("selected text");
  });

  it("falls back to execCommand when the Clipboard API is withheld", async () => {
    // Teams and Outlook on the web serve their frames with a
    // Permissions-Policy that withholds clipboard-write, which is exactly
    // where this viewer has to work.
    setClipboard(() => Promise.reject(new Error("NotAllowedError")));
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
    });

    await expect(copyTextToClipboard("selected text")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    // The scratch textarea must not survive the copy.
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("reports failure when neither route works", async () => {
    setClipboard(() => Promise.reject(new Error("NotAllowedError")));
    Object.defineProperty(document, "execCommand", {
      value: vi.fn(() => false),
      configurable: true,
    });

    await expect(copyTextToClipboard("selected text")).resolves.toBe(false);
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("does nothing for an empty selection", async () => {
    const writeText = vi.fn(async () => undefined);
    setClipboard(writeText);

    await expect(copyTextToClipboard("")).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});
