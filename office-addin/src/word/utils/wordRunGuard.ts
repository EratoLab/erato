import { wordWriteHost } from "./wordWriteHost";

export class WordRunAborted extends Error {
  constructor() {
    super("The Word run was abandoned after its timeout");
    this.name = "WordRunAborted";
  }
}

export interface WordRunGuard {
  readonly aborted: boolean;
  readonly writeQueued: boolean;
  /** Call synchronously right before queuing the writes, with no await until their sync: once the
   * caller has been told the run timed out, nothing may be written. */
  beforeWrite(): void;
  beforeSelect(): void;
}

export interface WordGuardedResult<T> {
  outcome: "ok" | "timeout" | "error";
  value?: T;
  error?: unknown;
  /** A timed-out or failed run may still have written: only a run that never passed beforeWrite()
   * may be reported as having changed nothing. */
  writeQueued: boolean;
  /** Resolves once Word.run itself has settled, which after a timeout may be much later. */
  settled: Promise<void>;
}

/** A timeout cannot cancel Word.run, which keeps running against the document; the guard only
 * stops this callback from queuing anything further. */
export function runWordGuarded<T>(
  callback: (context: Word.RequestContext, guard: WordRunGuard) => Promise<T>,
  options: { timeoutMs: number },
): Promise<WordGuardedResult<T>> {
  let aborted = false;
  let writeQueued = false;
  const guard: WordRunGuard = {
    get aborted() {
      return aborted;
    },
    get writeQueued() {
      return writeQueued;
    },
    beforeWrite() {
      if (aborted) throw new WordRunAborted();
      writeQueued = true;
    },
    beforeSelect() {
      if (aborted) throw new WordRunAborted();
    },
  };

  const word = wordWriteHost();
  if (!word) {
    return Promise.resolve({
      outcome: "error",
      error: new Error("Word is not available"),
      writeQueued: false,
      settled: Promise.resolve(),
    });
  }

  let run: Promise<T>;
  try {
    run = word.run((context) => callback(context, guard));
  } catch (error) {
    run = Promise.reject(error);
  }
  const settled = run.then(
    () => undefined,
    () => undefined,
  );

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      aborted = true;
      resolve({ outcome: "timeout", writeQueued, settled });
    }, options.timeoutMs);
    run.then(
      (value) => {
        clearTimeout(timer);
        resolve({ outcome: "ok", value, writeQueued, settled });
      },
      (error: unknown) => {
        clearTimeout(timer);
        resolve({ outcome: "error", error, writeQueued, settled });
      },
    );
  });
}
