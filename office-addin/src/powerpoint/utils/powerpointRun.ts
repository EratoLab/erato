let queue: Promise<unknown> = Promise.resolve();

export class PowerPointTimeoutError extends Error {
  constructor(what: string) {
    super(`${what} did not answer in time`);
    this.name = "PowerPointTimeoutError";
  }
}

/** Rejects after `ms`; the work itself cannot be cancelled and may still finish later. */
export function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PowerPointTimeoutError(what)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Every read waits its turn. Reported by the office-agents add-in for PowerPoint on the web, not
 * measured here; serialising costs little either way. With `timeoutMs` the queue moves on when the
 * batch is late, so one stuck call cannot hold every later read.
 */
export function runPowerPoint<T>(
  batch: (context: PowerPoint.RequestContext) => Promise<T>,
  timeoutMs?: number,
): Promise<T> {
  const run = queue.then(() =>
    timeoutMs === undefined
      ? PowerPoint.run(batch)
      : withTimeout(PowerPoint.run(batch), timeoutMs, "PowerPoint"),
  );
  queue = run.catch(() => undefined);
  return run;
}

/** Office.js errors carry a code; the message alone is often "GeneralException". */
export function powerpointErrorText(error: unknown): string {
  if (error && typeof error === "object") {
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (typeof code === "string" && typeof message === "string")
      return code === message ? code : `${code}: ${message}`;
    if (typeof message === "string") return message;
  }
  return String(error);
}
