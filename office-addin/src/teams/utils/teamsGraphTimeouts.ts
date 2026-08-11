/**
 * Whole-operation ceilings. The per-request ceiling lives in the transport
 * (`TEAMS_GRAPH_REQUEST_TIMEOUT_MS`); these bound the composed operation,
 * which for a transcript is many serial, deliberately rate-limited requests.
 */
export const TEAMS_GRAPH_LIST_TIMEOUT_MS = 30_000;
export const TEAMS_GRAPH_SEARCH_TIMEOUT_MS = 30_000;
export const TEAMS_GRAPH_TRANSCRIPT_TIMEOUT_MS = 120_000;
