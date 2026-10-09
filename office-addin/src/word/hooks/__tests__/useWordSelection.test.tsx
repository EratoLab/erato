import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetOfficeSelectionChangedBrokerForTests } from "../../../hooks/officeSelectionChangedBroker";
import {
  installWordSelectionHost,
  SV2_MAIN_DOCUMENT,
  uninstallWordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import {
  markProgrammaticWordSelection,
  PROGRAMMATIC_SELECTION_WINDOW_MS,
  resetProgrammaticWordSelectionForTests,
} from "../../utils/wordProgrammaticSelection";
import { WORD_SELECTION_DESCRIBE_TIMEOUT_MS } from "../../utils/wordSelectionCapture";
import {
  useWordSelection,
  WORD_SELECTION_DEBOUNCE_MS,
} from "../useWordSelection";
import {
  armWordSelection,
  EMPTY_WORD_SELECTION,
  wordSelectionStore,
} from "../wordSelectionStore";

import type { WordSelectionHost } from "../../../test/mocks/word/selectionHost";
import type { ReactNode } from "react";

const strict = ({ children }: { children: ReactNode }) => (
  <StrictMode>{children}</StrictMode>
);

const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(WORD_SELECTION_DEBOUNCE_MS);
  });

const state = () => wordSelectionStore.getSnapshot();
const shown = () => state().preview?.text;

let host: WordSelectionHost;

beforeEach(() => {
  vi.useFakeTimers();
  host = installWordSelectionHost(SV2_MAIN_DOCUMENT);
  host.select({ p: "PL1", text: "lima mike" });
});

afterEach(() => {
  vi.useRealTimers();
  uninstallWordSelectionHost();
  __resetOfficeSelectionChangedBrokerForTests();
  resetProgrammaticWordSelectionForTests();
  wordSelectionStore.resetForTests();
});

function mount(identity = "doc-a", enabled = true) {
  return renderHook(
    ({ identity: id, enabled: on }) => useWordSelection(id, on),
    { initialProps: { identity, enabled }, wrapper: strict },
  );
}

describe("useWordSelection", () => {
  it("reads the selection on mount through one handler under StrictMode", async () => {
    mount();
    expect(state().pending).toBe(true);
    await settle();
    expect(host.handlerCount()).toBe(1);
    expect(state()).toMatchObject({
      preview: { text: "lima mike", paragraphCount: 1 },
      origin: "user",
      armed: true,
      pending: false,
    });
  });

  it("reads once after a burst of selection events", async () => {
    mount();
    await settle();
    const reads = () =>
      host.calls().filter((call) => call === "Document.getSelection").length;
    const before = reads();
    act(() => {
      host.select({ p: "PL1", text: "kilo" });
      host.select({ p: "PL1", text: "kilo lima" });
      host.select({ p: "PL1", text: "oscar papa" });
    });
    expect(state().pending).toBe(true);
    await settle();
    expect(reads() - before).toBe(1);
    expect(shown()).toBe("oscar papa");
  });

  it("drops a read that a newer selection overtook", async () => {
    mount();
    await settle();
    const hang = host.hangSync({ execute: "immediately" });
    act(() => host.select({ p: "MP1", text: "victor" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORD_SELECTION_DEBOUNCE_MS);
    });
    await hang.reached;
    act(() => host.select({ p: "MP2", text: "xray" }));
    hang.release();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(state()).toMatchObject({
      preview: { text: "lima mike" },
      pending: true,
    });
    await settle();
    expect(shown()).toBe("xray");
  });

  it("keeps the last selection when a read fails", async () => {
    mount();
    await settle();
    host.hangSync();
    act(() => host.select({ p: "MP1", text: "victor" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        WORD_SELECTION_DEBOUNCE_MS + WORD_SELECTION_DESCRIBE_TIMEOUT_MS,
      );
    });
    expect(state()).toMatchObject({
      preview: { text: "lima mike" },
      pending: false,
    });
  });

  it("clears the selection when the document changes, then reads the new one", async () => {
    const { rerender } = mount();
    await settle();
    rerender({ identity: "doc-b", enabled: true });
    expect(state().preview).toBeNull();
    await settle();
    expect(shown()).toBe("lima mike");
  });

  it("offers nothing and registers no handler while disabled", async () => {
    mount("doc-a", false);
    await settle();
    expect(state()).toEqual(EMPTY_WORD_SELECTION);
    expect(host.addHandlerAsync).not.toHaveBeenCalled();
  });

  it("removes its handler on unmount", async () => {
    const { unmount } = mount();
    await settle();
    unmount();
    await settle();
    expect(host.handlerCount()).toBe(0);
    expect(state()).toEqual(EMPTY_WORD_SELECTION);
  });

  it("offers nothing when Word refuses selection events", async () => {
    host.failHandlerRegistration("Not supported");
    mount();
    await settle();
    expect(state()).toEqual(EMPTY_WORD_SELECTION);
  });

  it("shows a passage Erato selected unarmed until the user takes it over", async () => {
    mount();
    await settle();
    markProgrammaticWordSelection();
    act(() => host.select({ p: "MP1", text: "victor" }));
    expect(state().pending).toBe(false);
    await settle();
    expect(state()).toMatchObject({
      preview: { text: "victor" },
      origin: "erato",
      armed: false,
      pending: false,
    });

    act(() => armWordSelection());
    expect(state()).toMatchObject({ origin: "user", armed: true });

    markProgrammaticWordSelection();
    act(() => host.select({ p: "MP2", text: "xray" }));
    await settle();
    expect(state()).toMatchObject({ origin: "erato", armed: false });
    act(() => host.select({ p: "MP3", text: "zulu" }));
    await settle();
    expect(state()).toMatchObject({
      preview: { text: "zulu" },
      origin: "user",
      armed: true,
    });
  });

  it("disarms the moment Erato marks its own select, before Word moves the selection", async () => {
    mount();
    await settle();
    act(() => {
      markProgrammaticWordSelection();
    });
    expect(state()).toMatchObject({
      preview: { text: "lima mike" },
      armed: false,
      pending: false,
    });
  });

  it("stays unarmed when the read after Erato's select fails", async () => {
    mount();
    await settle();
    host.hangSync();
    act(() => {
      markProgrammaticWordSelection();
    });
    act(() => host.select({ p: "MP1", text: "victor" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        WORD_SELECTION_DEBOUNCE_MS + WORD_SELECTION_DESCRIBE_TIMEOUT_MS,
      );
    });
    expect(state()).toMatchObject({ armed: false, pending: false });
  });

  it("reads Erato's selection even when its event never comes", async () => {
    mount();
    await settle();
    act(() => {
      markProgrammaticWordSelection();
    });
    host.select({ p: "MP1", text: "victor" }, { event: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROGRAMMATIC_SELECTION_WINDOW_MS);
    });
    expect(state()).toMatchObject({
      preview: { text: "victor" },
      origin: "erato",
      armed: false,
    });
  });

  it("re-reads on request without an event, as the user's when re-arming", async () => {
    mount();
    await settle();
    markProgrammaticWordSelection();
    act(() => host.select({ p: "MP1", text: "victor" }));
    await settle();
    host.select({ p: "MP2", text: "xray" }, { event: false });

    act(() => wordSelectionStore.requestRefresh());
    await settle();
    expect(state()).toMatchObject({
      preview: { text: "xray" },
      origin: "erato",
      armed: false,
    });

    act(() => wordSelectionStore.requestRefresh({ rearm: true }));
    expect(state().pending).toBe(true);
    await settle();
    expect(state()).toMatchObject({ origin: "user", armed: true });
  });
});
