export type WordApplyStage = "checking" | "backup" | "writing" | "verifying";

/** requestAnimationFrame pauses in a hidden pane, so a timeout bounds the wait. */
export function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 50);
    const frame = globalThis.requestAnimationFrame;
    if (typeof frame !== "function") return;
    frame(() =>
      setTimeout(() => {
        clearTimeout(timeout);
        resolve();
      }, 0),
    );
  });
}

export interface WordApplyProgress {
  stage: (stage: WordApplyStage) => void;
  finish: (outcome: string) => void;
}

/** Logged at debug level so stage costs can be measured on real hosts. */
export function trackWordApply(
  kind: "plan" | "edits",
  onStage?: (stage: WordApplyStage) => void,
): WordApplyProgress {
  const started = globalThis.performance.now();
  const durations: Partial<Record<WordApplyStage, number>> = {};
  let current: { stage: WordApplyStage; at: number } | undefined;
  const close = () => {
    if (current)
      durations[current.stage] =
        (durations[current.stage] ?? 0) +
        globalThis.performance.now() -
        current.at;
    current = undefined;
  };
  return {
    stage: (stage) => {
      close();
      current = { stage, at: globalThis.performance.now() };
      onStage?.(stage);
    },
    finish: (outcome) => {
      close();
      console.debug("[erato] Word apply timings (ms)", {
        kind,
        outcome,
        total: Math.round(globalThis.performance.now() - started),
        ...Object.fromEntries(
          Object.entries(durations).map(([stage, ms]) => [
            stage,
            Math.round(ms),
          ]),
        ),
      });
    },
  };
}
