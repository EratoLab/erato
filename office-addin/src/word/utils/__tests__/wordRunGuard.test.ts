import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../../test/mocks/word/document";
import { runWordGuarded, WordRunAborted } from "../wordRunGuard";

import type { MockWordHost } from "../../../test/mocks/word/document";
import type { WordRunGuard } from "../wordRunGuard";

const TIMEOUT_MS = 1000;

/** Holds the nth sync of every run until release(), as a host that stops answering would. */
function hangSync(host: MockWordHost, nth: number): () => void {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const run = host.word.run;
  (globalThis as Record<string, unknown>).Word = {
    run: (callback: (context: unknown) => Promise<unknown>) =>
      run((context) => {
        const inner = context as { sync: () => Promise<void> };
        let syncs = 0;
        return callback({
          ...inner,
          sync: async () => {
            syncs += 1;
            if (syncs === nth) await gate;
            return inner.sync();
          },
        });
      }),
  };
  return release;
}

async function readThenReplace(
  context: Word.RequestContext,
  guard: WordRunGuard,
): Promise<string> {
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load("items/uniqueLocalId");
  await context.sync();
  guard.beforeWrite();
  paragraphs.items[0].insertText("Rewritten", "Replace");
  await context.sync();
  return "written";
}

describe("runWordGuarded", () => {
  let host: MockWordHost;
  beforeEach(() => {
    vi.useFakeTimers();
    host = installMockWordDocument([{ text: "Original" }]);
  });
  afterEach(() => {
    vi.useRealTimers();
    uninstallMockWordDocument();
  });

  it("resolves ok with the callback's value", async () => {
    const result = await runWordGuarded(readThenReplace, {
      timeoutMs: TIMEOUT_MS,
    });
    expect(result.outcome).toBe("ok");
    expect(result.value).toBe("written");
    expect(result.writeQueued).toBe(true);
    await expect(result.settled).resolves.toBeUndefined();
    expect(host.word.paragraphs()[0].text).toBe("Rewritten");
  });

  it("never queues a write once the read sync outlived the timeout", async () => {
    const release = hangSync(host, 1);
    let guard: WordRunGuard | undefined;
    let thrown: unknown;
    const pending = runWordGuarded(
      async (context, g) => {
        guard = g;
        try {
          return await readThenReplace(context, g);
        } catch (error) {
          thrown = error;
          throw error;
        }
      },
      { timeoutMs: TIMEOUT_MS },
    );
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    const result = await pending;
    expect(result.outcome).toBe("timeout");
    expect(result.writeQueued).toBe(false);
    expect(guard?.aborted).toBe(true);

    let settled = false;
    void result.settled.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    release();
    await result.settled;
    expect(settled).toBe(true);
    expect(thrown).toBeInstanceOf(WordRunAborted);
    expect(host.word.syncCount()).toBe(1);
    expect(host.word.writes()).toEqual([]);
    expect(host.word.paragraphs()[0].text).toBe("Original");
  });

  it("reports a write queued before the timeout as possibly written", async () => {
    const release = hangSync(host, 2);
    const pending = runWordGuarded(readThenReplace, { timeoutMs: TIMEOUT_MS });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    const result = await pending;
    expect(result.outcome).toBe("timeout");
    expect(result.writeQueued).toBe(true);

    release();
    await result.settled;
    expect(host.word.paragraphs()[0].text).toBe("Rewritten");
  });

  it("refuses to select after the timeout", async () => {
    const release = hangSync(host, 1);
    const pending = runWordGuarded(
      async (context, guard) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load("items/uniqueLocalId");
        await context.sync();
        guard.beforeSelect();
        paragraphs.items[0].getRange("Content").select();
        await context.sync();
      },
      { timeoutMs: TIMEOUT_MS },
    );
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    const result = await pending;
    release();
    await result.settled;
    expect(result.outcome).toBe("timeout");
    expect(result.writeQueued).toBe(false);
    expect(host.word.selections()).toEqual([]);
  });

  it("resolves with an error instead of rejecting", async () => {
    const failure = new Error("GeneralException");
    const thrown = await runWordGuarded(() => Promise.reject(failure), {
      timeoutMs: TIMEOUT_MS,
    });
    expect(thrown).toMatchObject({
      outcome: "error",
      error: failure,
      writeQueued: false,
    });

    host.word.failWriteOn("id-1");
    const failedWrite = await runWordGuarded(readThenReplace, {
      timeoutMs: TIMEOUT_MS,
    });
    expect(failedWrite.outcome).toBe("error");
    expect(failedWrite.writeQueued).toBe(true);

    (globalThis as Record<string, unknown>).Word = {
      run: () => {
        throw new Error("RichApi.Error");
      },
    };
    expect(
      (await runWordGuarded(readThenReplace, { timeoutMs: TIMEOUT_MS }))
        .outcome,
    ).toBe("error");

    delete (globalThis as Record<string, unknown>).Word;
    const missing = await runWordGuarded(readThenReplace, {
      timeoutMs: TIMEOUT_MS,
    });
    expect(missing.outcome).toBe("error");
    await expect(missing.settled).resolves.toBeUndefined();
  });

  it("does not time out a run that settled first", async () => {
    const result = await runWordGuarded(async () => "done", {
      timeoutMs: TIMEOUT_MS,
    });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 2);
    expect(result.outcome).toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
  });
});
