let queue: Promise<unknown> = Promise.resolve();

/**
 * Every read waits its turn. Reported by the office-agents add-in for PowerPoint on the web, not
 * measured here; serialising costs little either way.
 */
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
