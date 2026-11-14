let queue: Promise<unknown> = Promise.resolve();

/** PowerPoint on the web fails overlapping PowerPoint.run batches, so every read waits its turn. */
export function runPowerPoint<T>(
  batch: (context: PowerPoint.RequestContext) => Promise<T>,
): Promise<T> {
  const run = queue.then(() => PowerPoint.run(batch));
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
