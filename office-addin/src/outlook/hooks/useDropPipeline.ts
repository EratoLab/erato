import { useCallback, useMemo, useRef, useState } from "react";

export type DropPipelinePhase =
  | "idle"
  | "receiving"
  | "reading"
  | "resolving"
  | "staging";

export interface DropPipelineState {
  phase: DropPipelinePhase;
  /** Items finished in the current phase (1-based index of the current one). */
  done: number;
  total: number;
  /** Subject or filename of the item currently in flight. */
  name?: string;
}

export interface DropPipelineProgress {
  stage: Exclude<DropPipelinePhase, "idle">;
  index: number;
  total: number;
  name?: string;
}

export interface DropPipeline extends DropPipelineState {
  /**
   * Opens a span for one drop. Returns an idempotent release that closes it;
   * the code that opened a span owns closing it.
   */
  begin: (total: number) => () => void;
  progress: (update: DropPipelineProgress) => void;
  stage: (phase: Exclude<DropPipelinePhase, "idle">) => void;
  /** Closes one open span. */
  end: () => void;
}

const IDLE: DropPipelineState = { phase: "idle", done: 0, total: 0 };

/**
 * Tracks dropped items on their way into the composer so the input can show
 * which step is running. Spans nest: the phase leaves `idle` on the first
 * `begin` and returns only when every open span has been released, so a
 * second drop while one is still running never blanks the indicator.
 */
export function useDropPipeline(): DropPipeline {
  const [state, setState] = useState<DropPipelineState>(IDLE);
  const pendingRef = useRef(0);

  const end = useCallback(() => {
    if (pendingRef.current === 0) return;
    pendingRef.current -= 1;
    if (pendingRef.current === 0) setState(IDLE);
  }, []);

  const begin = useCallback(
    (total: number) => {
      pendingRef.current += 1;
      if (pendingRef.current === 1) {
        setState({ phase: "receiving", done: 0, total });
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        end();
      };
    },
    [end],
  );

  const progress = useCallback(
    ({ stage, index, total, name }: DropPipelineProgress) => {
      if (pendingRef.current === 0) return;
      setState({ phase: stage, done: index, total, name });
    },
    [],
  );

  const stage = useCallback((phase: Exclude<DropPipelinePhase, "idle">) => {
    if (pendingRef.current === 0) return;
    setState((previous) => ({ ...previous, phase }));
  }, []);

  return useMemo(
    () => ({ ...state, begin, progress, stage, end }),
    [state, begin, progress, stage, end],
  );
}
