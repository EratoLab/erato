/* eslint-disable lingui/no-unlocalized-strings -- Protocol values and model-facing errors. */
import {
  SIDECAR_PROVIDER,
  SidecarClientError,
  SidecarRpcError,
} from "@erato/desktop-sidecar-protocol";

import type {
  CallToolResult,
  DesktopSidecarClient,
  JobCallResult,
  JobStatus,
} from "@erato/desktop-sidecar-protocol";

/**
 * The shortest time between two job requests. A sidecar that answers a
 * status request at once, instead of holding it for `wait_ms`, is polled at
 * the cadence local tasks use while a native job is about to change state
 * (EratoLab/erato#1456).
 */
export const JOB_POLL_INTERVAL_MS = 1_500;

const PENDING_STATES = new Set<JobStatus["state"]>([
  "queued",
  "running",
  "awaiting_approval",
  "ready_for_review",
]);

/**
 * Whether the sidecar runs `tool` as a job (SPEC §3): discovery reports the
 * job envelope and an available `sidecar` provider that lists the tool, and
 * jobs.start.v1 and jobs.status.v1 are enabled. Otherwise the tool keeps its
 * direct RPCs.
 */
export function runsAsSidecarJob(
  client: DesktopSidecarClient,
  tool: string,
): boolean {
  const { jobs, providers } = client.getSnapshot();
  return (
    jobs !== undefined &&
    (providers ?? []).some(
      (provider) =>
        provider.id === SIDECAR_PROVIDER.id &&
        provider.available &&
        provider.tools.includes(tool),
    ) &&
    client.supports("jobs.start.v1") &&
    client.supports("jobs.status.v1")
  );
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

/**
 * A job that ended without results. The sidecar reports a handle it no
 * longer knows, as after the app restarted, as expired: the call is lost the
 * way a direct request is when the app goes away.
 */
function endedWithoutResult(state: JobStatus["state"]): SidecarClientError {
  return state === "expired"
    ? new SidecarClientError(
        "transport_error",
        "The Erato desktop app no longer has this call, so it returned no result.",
      )
    : new SidecarClientError(
        "sidecar_internal",
        `The Erato desktop app ended this call without a result (${state}).`,
      );
}

/**
 * Runs one built-in tool call as a job and returns its MCP result. A call
 * that fails throws the error its direct RPC would have thrown, so callers
 * handle both paths alike. Each call is its own job: the client tool runner
 * hands the executors one call at a time.
 */
export async function runSidecarJob(
  client: DesktopSidecarClient,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<CallToolResult> {
  const waitMs = client.getSnapshot().jobs?.maxWaitMs ?? 0;
  const wait = waitMs > 0 ? { wait_ms: waitMs } : {};
  let askedAt = Date.now();
  let status = await client.invoke(
    "jobs.start.v1",
    {
      calls: [{ server: SIDECAR_PROVIDER.id, name, arguments: args }],
      ...wait,
    },
    { signal },
  );
  const { handle } = status;
  try {
    while (!status.results && PENDING_STATES.has(status.state)) {
      const early = JOB_POLL_INTERVAL_MS - (Date.now() - askedAt);
      if (early > 0) await pause(early, signal);
      askedAt = Date.now();
      status = await client.invoke(
        "jobs.status.v1",
        { handle, ...wait },
        { signal },
      );
    }
  } catch (error) {
    // A stopped call must stop the device too; the job would run on.
    if (signal?.aborted)
      void client.invoke("jobs.cancel.v1", { handle }).catch(() => undefined);
    throw error;
  }
  const outcome = status.results?.[0];
  if (!outcome) throw endedWithoutResult(status.state);
  // The sidecar keeps delivered results until they are acknowledged; this
  // client never reads them again.
  void client.invoke("jobs.ack.v1", { handle }).catch(() => undefined);
  if (isCallError(outcome)) {
    const { code, message, data } = outcome.error;
    throw new SidecarRpcError(code, message, data);
  }
  return outcome.result;
}

/** The schema admits a result or an error per call, never both. */
function isCallError(
  outcome: JobCallResult,
): outcome is Extract<JobCallResult, { error: unknown }> {
  return "error" in outcome;
}
