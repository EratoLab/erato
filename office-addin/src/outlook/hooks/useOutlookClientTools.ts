import { registerClientToolExecutor } from "@erato/frontend/library";
import { useEffect, useRef } from "react";

import { useOutlookCalendarFetcher } from "./useOutlookCalendarFetcher";
import {
  FETCH_AVAILABILITY_TOOL_NAME,
  createFetchAvailabilityExecutor,
} from "../utils/outlookScheduleTool";

/**
 * Register this add-in's client-tool executors with the shared streaming
 * loop's registry (see `clientToolExecutors.ts` in the frontend library).
 * Registered once for the component's lifetime; the calendar fetcher is read
 * through a ref per call so backend selection (EWS vs Graph, auth becoming
 * ready) is always current without re-registering. A `fetch_availability`
 * call while no fetcher applies returns a clean error result, so the backend
 * resumes immediately instead of parking to timeout.
 */
export function useOutlookClientTools(): void {
  const { fetcher } = useOutlookCalendarFetcher();
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(
    () =>
      registerClientToolExecutor(
        FETCH_AVAILABILITY_TOOL_NAME,
        createFetchAvailabilityExecutor(() => fetcherRef.current),
      ),
    [],
  );
}
