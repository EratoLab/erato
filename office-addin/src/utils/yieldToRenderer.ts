interface SchedulerLike {
  yield?: () => Promise<void>;
}

/**
 * Lets the renderer paint pending state before the next chunk of work.
 * Prefers `scheduler.yield()`, which resumes ahead of other queued tasks.
 */
export function yieldToRenderer(): Promise<void> {
  const scheduler = (globalThis as unknown as { scheduler?: SchedulerLike })
    .scheduler;
  if (typeof scheduler?.yield === "function") {
    return scheduler.yield();
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}
