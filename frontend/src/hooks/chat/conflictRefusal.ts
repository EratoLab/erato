import { FrontendRequestError } from "@/utils/errorReport";

/**
 * A refusal read off an SSE route's error response.
 *
 * `code` is what the caller discriminates on, never the status. Both of
 * `/react`'s refusals are `409` — the OpenAPI document crams them into one
 * `CONFLICT` entry, so the generated `ReactToTaskResultSseError` names only
 * `GenerationRunningError` and `NothingToReactError` is unreachable through
 * the union. Casting a 409 to either type would be wrong about half of them.
 */
export interface ConflictRefusal {
  status: number;
  /** `generation_running` or `nothing_to_react`; absent for a plain-text body. */
  code?: string;
  /** `nothing_to_react` only: not_a_task_result | not_delivered | already_reacted | tip_moved. */
  reason?: string;
}

/**
 * Reads the status and, when the body is JSON, the refusal envelope.
 *
 * The error arrives as a `FrontendRequestError` thrown by
 * `createSSEConnection`'s `!response.ok` branch; the response context lands on
 * `.response` (not `.responseContext`, which is only the shape the SSE client
 * builds internally). The body is not always JSON — an archived chat answers
 * `409` as plain text — so the parse is best-effort and an unparseable body
 * yields a status with no code, which every caller treats as "log and
 * suppress" rather than a crash.
 */
export const readConflictRefusal = (error: unknown): ConflictRefusal | null => {
  if (!(error instanceof FrontendRequestError)) {
    return null;
  }
  const status = error.response?.status;
  if (status === undefined) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(error.response?.body ?? "");
  } catch {
    parsed = undefined;
  }
  const envelope =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { code?: unknown; reason?: unknown })
      : {};
  return {
    status,
    ...(typeof envelope.code === "string" ? { code: envelope.code } : {}),
    ...(typeof envelope.reason === "string" ? { reason: envelope.reason } : {}),
  };
};
