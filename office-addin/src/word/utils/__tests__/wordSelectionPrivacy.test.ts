import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetOfficeSelectionChangedBrokerForTests } from "../../../hooks/officeSelectionChangedBroker";
import {
  installWordSelectionHost,
  uninstallWordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import { useWordSelection } from "../../hooks/useWordSelection";
import { wordSelectionStore } from "../../hooks/wordSelectionStore";
import {
  replaceWordSelection,
  revertWordSelection,
} from "../wordReplaceSelection";
import { emptySelectionCapture } from "../wordSelectionAnchor";
import {
  captureWordSelection,
  describeWordSelection,
} from "../wordSelectionCapture";
import { showWordSelection } from "../wordSelectionTarget";

import type { WordSelectionHost } from "../../../test/mocks/word/selectionHost";
import type { WordSelectionShape } from "../wordSelectionAnchor";

const SENTINEL = "SENTINEL-7f3a";
const PARAGRAPHS = new Set<WordSelectionShape>(["paragraph"]);
const LEVELS = ["log", "info", "warn", "error", "debug"] as const;

/** An Office.js error that quotes the document, as some host messages do. */
function officeError(): Error {
  return Object.assign(new Error(`Could not read "${SENTINEL} text"`), {
    name: "RichApi.Error",
    code: "GeneralException",
  });
}

describe("selection editing privacy", () => {
  let host: WordSelectionHost;
  const spies = LEVELS.map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
  const logged = () =>
    spies.flatMap((spy) => spy.mock.calls.map((call) => JSON.stringify(call)));

  beforeEach(() => {
    for (const spy of spies) spy.mockClear();
    host = installWordSelectionHost({
      body: ["Intro.", `${SENTINEL} secret paragraph words.`, "Outro."],
    });
    host.select({ paragraph: 1 });
  });

  afterEach(() => {
    uninstallWordSelectionHost();
    __resetOfficeSelectionChangedBrokerForTests();
    wordSelectionStore.resetForTests();
  });

  const failEverySync = () =>
    host.beforeSync(() => {
      throw officeError();
    });

  it("logs no document text when capture, show, replace and undo succeed or fail", async () => {
    const read = await captureWordSelection("user", 15_000, PARAGRAPHS);
    if (read.status !== "ok" || !read.value) throw new Error("no capture");
    const capture = emptySelectionCapture("doc", read.value);
    await describeWordSelection();
    await showWordSelection(read.value, "doc", "doc");
    const applied = await replaceWordSelection({
      capture,
      fenceContent: `${SENTINEL} rewritten.`,
      enabledShapes: PARAGRAPHS,
    });
    if (applied.status !== "applied" || !applied.backups)
      throw new Error("not applied");
    await revertWordSelection(applied.backups, applied.written);

    const stop = failEverySync();
    await captureWordSelection("user", 15_000, PARAGRAPHS);
    await describeWordSelection();
    await showWordSelection(read.value, "doc", "doc");
    await replaceWordSelection({
      capture,
      fenceContent: `${SENTINEL} again.`,
      enabledShapes: PARAGRAPHS,
    });
    await revertWordSelection(applied.backups, applied.written);
    stop();

    expect(logged().length).toBeGreaterThan(0);
    expect(logged().filter((line) => line.includes(SENTINEL))).toEqual([]);
  });

  it("logs no document text when an inline span's range build, replace, undo or show fails", async () => {
    const INLINE = new Set<WordSelectionShape>(["paragraph", "inline"]);
    host.select({ paragraph: 1, text: `${SENTINEL} secret` });
    const read = await captureWordSelection("user", 15_000, INLINE);
    if (read.status !== "ok" || !read.value) throw new Error("no capture");
    expect(read.value.role).toBe("rewrite");
    const capture = emptySelectionCapture("doc", read.value);
    const applied = await replaceWordSelection({
      capture,
      fenceContent: `${SENTINEL} kept`,
      enabledShapes: INLINE,
    });
    if (applied.status !== "applied" || !applied.backups)
      throw new Error("not applied");
    await revertWordSelection(applied.backups, applied.written);

    const stopSearch = host.onSearch(() => {
      throw officeError();
    });
    await showWordSelection(read.value, "doc", "doc", INLINE);
    await replaceWordSelection({
      capture,
      fenceContent: `${SENTINEL} again`,
      enabledShapes: INLINE,
    });
    stopSearch();
    const stop = failEverySync();
    await showWordSelection(read.value, "doc", "doc", INLINE);
    await replaceWordSelection({
      capture,
      fenceContent: `${SENTINEL} again`,
      enabledShapes: INLINE,
    });
    await revertWordSelection(applied.backups, applied.written);
    stop();

    expect(logged().length).toBeGreaterThan(0);
    expect(logged().filter((line) => line.includes(SENTINEL))).toEqual([]);
  });

  it("logs no document text when a multi-paragraph span's range build, replace, undo or show fails", async () => {
    const ALL = new Set<WordSelectionShape>([
      "paragraph",
      "inline",
      "multi_paragraph",
      "table_cell",
    ]);
    host.select({
      paragraph: 0,
      text: "ro.",
      to: { paragraph: 1, text: `${SENTINEL} secret` },
    });
    const read = await captureWordSelection("user", 15_000, ALL);
    if (read.status !== "ok" || !read.value) throw new Error("no capture");
    expect(read.value).toMatchObject({
      role: "rewrite",
      shape: "multi_paragraph",
    });
    const capture = emptySelectionCapture("doc", read.value);
    const applied = await replaceWordSelection({
      capture,
      fenceContent: `ro.\n${SENTINEL} kept`,
      enabledShapes: ALL,
    });
    if (applied.status !== "applied" || !applied.backups)
      throw new Error("not applied");
    await revertWordSelection(applied.backups, applied.written);

    const stopSearch = host.onSearch(() => {
      throw officeError();
    });
    await showWordSelection(read.value, "doc", "doc", ALL);
    await replaceWordSelection({
      capture,
      fenceContent: `ro.\n${SENTINEL} again`,
      enabledShapes: ALL,
    });
    stopSearch();
    const stop = failEverySync();
    await showWordSelection(read.value, "doc", "doc", ALL);
    await replaceWordSelection({
      capture,
      fenceContent: `ro.\n${SENTINEL} again`,
      enabledShapes: ALL,
    });
    await revertWordSelection(applied.backups, applied.written);
    stop();

    expect(logged().length).toBeGreaterThan(0);
    expect(logged().filter((line) => line.includes(SENTINEL))).toEqual([]);
  });

  it("logs no document text from the live reader when its reads fail", async () => {
    vi.useFakeTimers();
    try {
      failEverySync();
      renderHook(() => useWordSelection("doc", true));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      act(() => host.select({ paragraph: 2 }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(logged().filter((line) => line.includes(SENTINEL))).toEqual([]);
  });
});
