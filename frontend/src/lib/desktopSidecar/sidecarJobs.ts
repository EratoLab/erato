/* eslint-disable lingui/no-unlocalized-strings -- Protocol values and model-facing errors. */
import {
  SIDECAR_PROVIDER,
  SidecarClientError,
  SidecarRpcError,
} from "@erato/desktop-sidecar-protocol";
import { i18n } from "@lingui/core";

import { requestClientOperationSweep } from "@/lib/clientOperations/handlers";
import { getClientPlatform } from "@/lib/clientPlatform";

import {
  forgetReview,
  markReviewEnded,
  rememberReview,
  reviewLink,
  reviewLinkKey,
} from "./sidecarReviewLinks";
import { markAwaitingReview } from "./sidecarReviewStore";

import type {
  CallToolResult,
  DesktopSidecarClient,
  JobCallResult,
  JobStatus,
} from "@erato/desktop-sidecar-protocol";

/**
 * The shortest time between two job requests. A sidecar that answers a
 * status request at once, instead of holding it for `wait_ms`, is polled at
 * this cadence.
 */
export const JOB_POLL_INTERVAL_MS = 1_500;

/**
 * Who asks for a review and how this client looks right now: the review
 * window names the surface and follows its language, colour and text size.
 * The colour is the one ThemeProvider resolved, because a person on the system
 * setting sees their Office host's colour in an add-in, not the operating
 * system's. Display data; a sidecar built before it ignores the fields.
 */
function reviewClient(): {
  platform: string;
  locale?: string;
  theme_mode?: string;
  text_size: string;
} {
  const root = document.documentElement;
  const colour = root.getAttribute("data-theme");
  return {
    platform: getClientPlatform(),
    ...(i18n.locale ? { locale: i18n.locale } : {}),
    ...(colour ? { theme_mode: colour } : {}),
    text_size: root.getAttribute("data-text-size") ?? "default",
  };
}

const PENDING_STATES = new Set<JobStatus["state"]>([
  "queued",
  "running",
  "awaiting_approval",
  "ready_for_review",
]);

/**
 * Whether strict mode reviews `tool`'s results before they leave the device:
 * its provider entry selects items (DELEGATION.md, "Results and selection").
 * A tool the table does not know counts as reviewed.
 */
export function reviewedUnderStrict(tool: string): boolean {
  return (
    SIDECAR_PROVIDER.tools.find(({ name }) => name === tool)?.selection !== null
  );
}

/**
 * Whether the sidecar runs `tool` as a job (SPEC §3): discovery reports the
 * job envelope and an available `sidecar` provider that lists the tool, and
 * jobs.start.v1 and jobs.status.v1 are enabled. Under strict mode a reviewed
 * tool also needs jobs.review.v1, which opens the native review; without it
 * the job would wait for a decision nobody can make. Otherwise the tool
 * keeps its direct RPCs, outside strict mode.
 */
export function runsAsSidecarJob(
  client: DesktopSidecarClient,
  tool: string,
): boolean {
  const { strict, jobs, providers } = client.getSnapshot();
  return (
    jobs !== undefined &&
    (providers ?? []).some(
      (provider) =>
        provider.id === SIDECAR_PROVIDER.id &&
        provider.available &&
        provider.tools.includes(tool),
    ) &&
    client.supports("jobs.start.v1") &&
    client.supports("jobs.status.v1") &&
    (strict !== true ||
      !reviewedUnderStrict(tool) ||
      client.supports("jobs.review.v1"))
  );
}

/**
 * A strict job's review that ended without sharing anything: the user
 * declined it in the Erato desktop app, it was cancelled there, or it expired
 * before a decision. Retrying the call cannot change that.
 */
export class SidecarReviewEndedError extends Error {
  constructor(readonly state: "declined" | "cancelled" | "expired") {
    super(`The review of this call ended as ${state}.`);
    this.name = "SidecarReviewEndedError";
  }
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
 * A job that ended without results. After a review, a decline, cancellation
 * or expiry is the review's outcome. Otherwise the sidecar reports a handle it
 * no longer knows, as after the app restarted, as expired: the call is lost
 * the way a direct request is when the app goes away.
 */
function endedWithoutResult(
  state: JobStatus["state"],
  reviewed: boolean,
): Error {
  if (
    state === "declined" ||
    (reviewed && (state === "cancelled" || state === "expired"))
  )
    return new SidecarReviewEndedError(state);
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

export interface SidecarJobOptions {
  signal?: AbortSignal;
  /** The chat that made the call, which waits while its review is open. */
  chatId?: string;
  /** The chat a task's call runs for, which waits on that review as well. */
  ownerChatId?: string;
  /**
   * The call itself, with its message: a review it reaches is kept under
   * them, so a later run of the same call finds its job and the chat can show
   * the window again.
   */
  toolCallId?: string;
  messageId?: string;
  /**
   * Called once when the job waits for its review and the native window has
   * been asked to open, so the caller can stop holding its turn for the
   * decision. The job is polled on until the user decides or it ends.
   */
  onReview?: () => void;
}

/**
 * Runs one built-in tool call as a job and returns its MCP result. A job that
 * waits for its review in strict mode gets the native review window opened
 * once and is polled until the user decides there: a review has no deadline
 * on this side. A call that fails throws the error its direct RPC would have
 * thrown, so callers handle both paths alike. Each call is its own job: the
 * client tool runner hands the executors one call at a time.
 *
 * A call run again after its page went away first asks after the job it
 * remembers: the decision may have been made while no page polled. Only a
 * job that nothing decided, one that was cancelled or that failed, starts
 * over. A pending job is also what a start of the same call would have found
 * (DELEGATION.md, "Job envelope").
 */
export async function runSidecarJob(
  client: DesktopSidecarClient,
  name: string,
  args: Record<string, unknown>,
  {
    signal,
    chatId,
    ownerChatId,
    toolCallId,
    messageId,
    onReview,
  }: SidecarJobOptions = {},
): Promise<CallToolResult> {
  const waitMs = client.getSnapshot().jobs?.maxWaitMs ?? 0;
  const wait = waitMs > 0 ? { wait_ms: waitMs } : {};
  const key =
    messageId !== undefined && toolCallId !== undefined
      ? reviewLinkKey(messageId, toolCallId)
      : undefined;
  const resumed = key ? await resumedJob(client, key, signal) : undefined;
  let askedAt = Date.now();
  let status =
    resumed ??
    (await client.invoke(
      "jobs.start.v1",
      {
        calls: [{ server: SIDECAR_PROVIDER.id, name, arguments: args }],
        ...wait,
      },
      { signal },
    ));
  const { handle } = status;
  // A remembered job reached its review on an earlier run.
  let reviewed = resumed !== undefined;
  let reviewOpened = false;
  let reviewEnded: (() => void) | undefined;
  try {
    while (!status.results && PENDING_STATES.has(status.state)) {
      if (status.state === "ready_for_review" && !reviewOpened) {
        reviewed = true;
        reviewOpened = true;
        if (chatId) reviewEnded = markAwaitingReview(chatId);
        // Before the window opens: the decision can outlive this page.
        if (key)
          rememberReview(
            key,
            handle,
            [chatId, ownerChatId].filter(
              (id): id is string => id !== undefined,
            ),
            // Only a task's call runs for another chat. Every chat that shows
            // the review reads this, not where it is shown.
            { task: ownerChatId !== undefined },
          );
        // The decision is made only in the native window; this opens it.
        if (client.supports("jobs.review.v1"))
          await client.invoke(
            "jobs.review.v1",
            { handle, client: reviewClient() },
            { signal },
          );
        onReview?.();
      }
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
    // A call that stops or fails must stop the device too: the job would run
    // on and keep its results until they expire. Cancelling is idempotent.
    void client.invoke("jobs.cancel.v1", { handle }).catch(() => undefined);
    // A Stop ends the review for good. A failed poll does not: the window may
    // still take a decision, and the next run finds it through this link.
    if (key && signal?.aborted) forgetReview(key);
    throw error;
  } finally {
    reviewEnded?.();
  }
  const outcome = status.results?.[0];
  if (key) {
    if (!outcome && reviewed && status.state === "expired")
      markReviewEnded(key);
    else forgetReview(key);
  }
  if (!outcome) throw endedWithoutResult(status.state, reviewed);
  // The sidecar keeps delivered results until they are acknowledged; this
  // client never reads them again.
  void client.invoke("jobs.ack.v1", { handle }).catch(() => undefined);
  if (isCallError(outcome)) {
    const { code, message, data } = outcome.error;
    throw new SidecarRpcError(code, message, data);
  }
  return outcome.result;
}

/** Job states that say nothing about the user's decision. */
const STARTS_OVER = new Set<JobStatus["state"]>([
  "cancelled",
  "failed",
  "acked",
]);

/**
 * The job whose review `key`'s call reached on an earlier run, as it stands
 * now, or nothing when the call starts a job of its own. It may have been
 * decided since, with no page polling, so a Share or a Decline is delivered
 * rather than asked again.
 */
async function resumedJob(
  client: DesktopSidecarClient,
  key: string,
  signal: AbortSignal | undefined,
): Promise<JobStatus | undefined> {
  const link = reviewLink(key);
  if (link?.state === "ended") throw new SidecarReviewEndedError("expired");
  if (link?.state !== "open") return undefined;
  // No wait: an undecided review opens again right away.
  const status = await client.invoke(
    "jobs.status.v1",
    { handle: link.handle },
    { signal },
  );
  if (!STARTS_OVER.has(status.state)) return status;
  forgetReview(key);
  return undefined;
}

/**
 * Shows the review of `key`'s call again, with its selection, or brings its
 * window to the front. `jobs.review.v1` only ever opens the job the link
 * names and reports any other state, so asking can never start a second
 * review. A job decided in the meantime is delivered by the call's next run.
 */
export async function reopenSidecarReview(
  client: DesktopSidecarClient,
  key: string,
): Promise<void> {
  const link = reviewLink(key);
  if (link?.state !== "open") return;
  const { state } = await client.invoke("jobs.review.v1", {
    handle: link.handle,
    client: reviewClient(),
  });
  if (state === "expired") markReviewEnded(key);
  else if (state !== "ready_for_review") requestClientOperationSweep();
}

/** The schema admits a result or an error per call, never both. */
function isCallError(
  outcome: JobCallResult,
): outcome is Extract<JobCallResult, { error: unknown }> {
  return "error" in outcome;
}
