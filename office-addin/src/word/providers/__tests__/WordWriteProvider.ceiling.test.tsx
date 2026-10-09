import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useWordWrite,
  WORD_OPERATION_CEILING_MS,
  WordWriteProvider,
} from "../WordWriteProvider";

import type { WordWriteContextValue } from "../WordWriteProvider";

let host: WordWriteContextValue;

function Probe() {
  host = useWordWrite();
  return null;
}

const providerFor = (identity: string) => (
  <WordWriteProvider
    documentIdentity={identity}
    capturesByAssistantMessageId={new Map()}
  >
    <Probe />
  </WordWriteProvider>
);

/** Starts an operation and hands it to the ceiling as a run that timed out would. */
function holdWith(settled: Promise<void>) {
  act(() => {
    expect(host.beginOperation()).toBe(true);
  });
  act(() => host.holdOperationUntil(settled, "card-1"));
}

describe("WordWriteProvider operation ceiling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps every card waiting until the ceiling when Word's run never ends", async () => {
    render(providerFor("doc"));
    holdWith(new Promise<void>(() => {}));
    expect(host.operationInProgress).toBe(true);
    expect(host.heldOperationOwner).toBe("card-1");
    expect(host.beginOperation()).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORD_OPERATION_CEILING_MS - 1);
    });
    expect(host.operationInProgress).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(host.operationInProgress).toBe(false);
    expect(host.heldOperationOwner).toBeNull();
  });

  it("releases once Word's run ends", async () => {
    render(providerFor("doc"));
    let settle!: () => void;
    holdWith(new Promise<void>((resolve) => (settle = resolve)));
    await act(async () => {
      settle();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(host.operationInProgress).toBe(false);
  });
});
