import { useEffect, useReducer } from "react";

import {
  SCHEDULING_THREAD_MAX_AGE_MS,
  isSchedulingThreadFresh,
} from "../utils/outlookScheduleTool";

/**
 * `isSchedulingThreadFresh` for render: re-renders once the window closes, so
 * what reads "not sent while scheduling" changes back without other input.
 */
export function useSchedulingThreadActive(
  lastSchedulingSignalAt: string | null,
): boolean {
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    if (lastSchedulingSignalAt === null) return;
    const createdMs = Date.parse(lastSchedulingSignalAt);
    if (Number.isNaN(createdMs)) return;
    // The helper keeps the boundary itself fresh, so wake 1 ms past it.
    const delay = createdMs + SCHEDULING_THREAD_MAX_AGE_MS + 1 - Date.now();
    if (delay <= 0) return;
    const timer = setTimeout(rerender, delay);
    return () => clearTimeout(timer);
  }, [lastSchedulingSignalAt]);

  return isSchedulingThreadFresh(lastSchedulingSignalAt, Date.now());
}
