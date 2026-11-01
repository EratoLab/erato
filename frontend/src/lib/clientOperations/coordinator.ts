/* eslint-disable lingui/no-unlocalized-strings -- Internal operation states and fixed errors. */
import { clientToolAcceptsGrantCalls } from "@/hooks/chat/clientToolExecutors";
import {
  fetchListClientOperations,
  fetchClaimClientOperation,
  fetchCompleteClientOperation,
  fetchContinueClientOperation,
  fetchCancelClientOperation,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { continueAttachedOperation } from "./attachedContinuation";
import { clientOperationDeviceId } from "./deviceId";
import {
  executorStreamHeaderSets,
  openExecutorStream,
  paneInstance,
} from "./executorStream";
import { clientOperationHandlerRegistry } from "./handlers";
import { withClientCallLock } from "./operationLock";
import { browserTabSignals, holdSharedStream } from "./sharedStream";

import type { ClientOperationHandlerRegistry } from "./handlers";
import type { TabSignals } from "./sharedStream";
import type {
  ClientOperationView,
  ClaimClientOperationResponse,
  ExecutorBinding,
  ListClientOperationsResponse,
  OperationRequest,
  OperationResult,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface ClientOperationApi {
  list(
    after: string | undefined,
    signal: AbortSignal,
  ): Promise<ListClientOperationsResponse>;
  claim(
    request: OperationRequest,
    binding: ExecutorBinding,
    signal: AbortSignal,
  ): Promise<ClaimClientOperationResponse>;
  complete(
    request: OperationRequest,
    token: string,
    result: OperationResult,
    signal: AbortSignal,
  ): Promise<unknown>;
  continue(id: string, signal: AbortSignal): Promise<unknown>;
  attach?(request: OperationRequest, signal: AbortSignal): Promise<unknown>;
  /** Holds one of the pane's executor streams open until `signal` aborts;
   * `onCall` gets each call it delivers while that call runs. */
  stream?(
    headers: Record<string, string>,
    onNudge: () => void,
    signal: AbortSignal,
    onCall?: (call: Promise<unknown>) => void,
  ): Promise<unknown>;
  cancel(id: string, signal: AbortSignal): Promise<unknown>;
}
function headers(request: OperationRequest): Record<string, string> {
  const tool = request.operation_id.split("/").at(-1) ?? "";
  // The windows of one Erato desktop app installation share its binding; a
  // claim names the client that holds it (this client's id, else this pane),
  // so another window waits for it to lapse instead of running the same call.
  const claimant = clientOperationDeviceId() ?? paneInstance();
  return {
    "X-Erato-Client-Tools": tool,
    "X-Erato-Executor": JSON.stringify(request.binding),
    "X-Erato-Executor-Claimant": claimant,
    // A task's call is claimed only by a pane whose handler checks its grant.
    ...(request.lineage && clientToolAcceptsGrantCalls(tool)
      ? { "X-Erato-Child-Client-Tools": tool }
      : {}),
  };
}
export const clientOperationApi: ClientOperationApi = {
  list: (after, signal) =>
    fetchListClientOperations({ queryParams: { after } }, signal),
  claim: (request, binding, signal) =>
    fetchClaimClientOperation(
      {
        pathParams: { attemptId: request.attempt_id },
        headers: headers(request),
        body: { binding, user_confirmed: false },
      },
      signal,
    ),
  complete: (request, claim_token, result, signal) =>
    fetchCompleteClientOperation(
      {
        pathParams: { attemptId: request.attempt_id },
        headers: headers(request),
        body: { claim_token, result },
      },
      signal,
    ),
  continue: (id, signal) =>
    fetchContinueClientOperation({ pathParams: { attemptId: id } }, signal),
  attach: continueAttachedOperation,
  stream: openExecutorStream,
  cancel: (id, signal) =>
    fetchCancelClientOperation({ pathParams: { attemptId: id } }, signal),
};

export type CoordinatorStatus = "unavailable" | "another_device" | "continuing";
export interface ClientOperationHandler {
  readonly kind: string;
  /** Narrows dispatch within a kind, e.g. to one tool's operation_id. */
  matches?(request: OperationRequest): boolean;
  /** Skips the claim for this sweep, e.g. while the live call still runs here. */
  defer?(request: OperationRequest): boolean;
  prepare?(signal: AbortSignal): Promise<void>;
  executor(): ExecutorBinding | undefined;
  execute(
    request: OperationRequest,
    claim: ClaimClientOperationResponse,
    signal: AbortSignal,
  ): Promise<OperationResult | undefined>;
  settled?(request: OperationRequest, signal: AbortSignal): Promise<void>;
  recover?(signal: AbortSignal): Promise<void>;
  review?(
    request: OperationRequest,
    claim: ClaimClientOperationResponse,
    signal: AbortSignal,
  ): Promise<void>;
  status?(request: OperationRequest, status: CoordinatorStatus): void;
  retain?(ids: Set<string>): void;
  reset?(): void;
  dispose?(): void;
}
// Renewals never come closer together than this, so a claim cut short by the
// attempt's end is not re-claimed in a loop.
const MIN_RENEWAL_MS = 1_000;
// How soon a renewal that the server never refused is tried again.
const RENEWAL_RETRY_MS = 5_000;
/** A request that never reached the server: what the generated fetcher throws
 * for a failed `fetch`, or the failed `fetch` itself. A refusal carries a
 * status or the server's own error body instead. */
function isTransportFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return (
    typeof error === "object" &&
    error !== null &&
    !("status" in error) &&
    (error as { name?: unknown }).name === "unknown"
  );
}
/** A renewal that failed without a refusal: it never reached the server, or
 * the server (or its ingress) failed. A read error answers 500 and withdraws
 * nothing, so only a 4xx or a lost binding ends the claim. */
function isRenewalNotRefused(error: unknown): boolean {
  if (isTransportFailure(error)) return true;
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? error.status
      : undefined;
  return typeof status === "number" && status >= 500;
}

function sameBinding(a: ExecutorBinding, b: ExecutorBinding): boolean {
  return (
    a.device_id === b.device_id &&
    a.realm === b.realm &&
    a.host_context?.kind === b.host_context?.kind &&
    a.host_context?.identity === b.host_context?.identity
  );
}
/** A claim kept alive while its handler works. */
interface HeldClaim {
  /** Aborts when the claim is refused or lapses, or the attempt ends. */
  signal: AbortSignal;
  /** The latest token, which the result must carry. */
  claim: () => ClaimClientOperationResponse;
  release: () => void;
}
/** Delay before the one early retry of a refused claim; the shell's poll stays
 * the fallback. */
const CLAIM_RETRY_MS = 1_500;
/** The server answers 409 for every unclaimable attempt, including one whose
 * chat still generates right after the park; the reason is not distinguishable. */
function isClaimRefusal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 409
  );
}

/** One account-scoped shell coordinator. Claims/results/continuations are
 * durable server authority; maps only avoid redundant work within this view. */
export class ClientOperationCoordinator {
  readonly #abort = new AbortController();
  readonly #operations = new Map<string, ClientOperationView>();
  readonly #claims = new Map<string, ClaimClientOperationResponse>();
  readonly #attached = new Set<string>();
  /** Attempts whose refused claim already had its early retry. */
  readonly #retried = new Set<string>();
  readonly #grantRuns = new Set<string>();
  /** Calls of the user's own turn queued or running beside the sweep. */
  readonly #ownRuns = new Set<string>();
  #ownQueue: Promise<void> = Promise.resolve();
  readonly #builtIns: readonly ClientOperationHandler[];
  readonly #unsubscribe: () => void;
  readonly #streams = new Map<string, AbortController>();
  #retry: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<void> | undefined;
  #refresh = false;
  enabled = true;
  constructor(
    readonly accountId: string,
    private readonly api: ClientOperationApi,
    builtIns: readonly ClientOperationHandler[],
    private readonly accountChanged: () => void,
    private readonly registry: ClientOperationHandlerRegistry = clientOperationHandlerRegistry,
    private readonly tabSignals: TabSignals = browserTabSignals,
  ) {
    this.#builtIns = builtIns;
    this.#unsubscribe = registry.subscribe(() => {
      void this.reconcile();
    });
  }
  dispose(): void {
    this.#abort.abort();
    this.#closeStreams();
    this.#unsubscribe();
    clearTimeout(this.#retry);
    this.#retry = undefined;
    this.#operations.clear();
    this.#claims.clear();
    this.#attached.clear();
    this.#retried.clear();
    this.#grantRuns.clear();
    this.#ownRuns.clear();
    this.#builtIns.forEach((handler) => handler.dispose?.());
  }
  #handlers(): readonly ClientOperationHandler[] {
    return [...this.#builtIns, ...this.registry.handlers()];
  }
  #handlerFor(request: OperationRequest): ClientOperationHandler | undefined {
    return this.#handlers().find(
      (candidate) =>
        candidate.kind === request.kind &&
        (candidate.matches?.(request) ?? true),
    );
  }
  #check(): void {
    this.#abort.signal.throwIfAborted();
  }
  #closeStreams(keep: ReadonlySet<string> = new Set()): void {
    for (const [key, controller] of this.#streams)
      if (!keep.has(key)) {
        controller.abort();
        this.#streams.delete(key);
      }
  }
  /** Keeps one executor stream open per binding the pane serves. A shared
   * binding's stream is held by one tab of the browser profile at a time and
   * follows the tab the user uses. */
  #syncStreams(enabled: boolean): void {
    const sets = enabled && this.api.stream ? executorStreamHeaderSets() : [];
    const keys = new Map(sets.map((set) => [JSON.stringify(set), set]));
    this.#closeStreams(new Set(keys.keys()));
    for (const [key, { headers, shared }] of keys) {
      if (this.#streams.has(key)) continue;
      const controller = new AbortController();
      this.#streams.set(key, controller);
      const open = async (
        signal: AbortSignal,
        onCall?: (call: Promise<unknown>) => void,
      ) => {
        await this.api.stream?.(
          headers,
          () => {
            void this.reconcile();
          },
          signal,
          onCall,
        );
      };
      const locks = globalThis.navigator.locks as LockManager | undefined;
      void (
        shared && locks
          ? holdSharedStream({
              locks,
              key: headers["X-Erato-Executor"],
              open,
              signals: this.tabSignals,
              signal: controller.signal,
            })
          : open(controller.signal)
      )
        .catch(() => {
          /* The next sweep reopens it. */
        })
        .finally(() => {
          if (this.#streams.get(key) === controller) this.#streams.delete(key);
        });
    }
  }
  #continue(
    request: OperationRequest,
    handler: ClientOperationHandler,
  ): Promise<unknown> {
    const executor = handler.executor();
    if (
      request.kind === "client_tool.v1" &&
      request.consent === "none" &&
      this.api.attach
    ) {
      // An observer must not race the owning pane with a detached continuation.
      if (!executor || !sameBinding(executor, request.binding)) {
        handler.status?.(request, executor ? "another_device" : "unavailable");
        return Promise.resolve();
      }
      if (!this.#attached.has(request.attempt_id)) {
        this.#attached.add(request.attempt_id);
        void this.api
          .attach(request, this.#abort.signal)
          .catch(() => {
            /* A lost connection returns to inbox recovery. */
          })
          .finally(() => this.#attached.delete(request.attempt_id));
      }
      return Promise.resolve();
    }
    return this.api.continue(request.attempt_id, this.#abort.signal);
  }
  reconcile(): Promise<void> {
    if (this.#abort.signal.aborted || !this.enabled) return Promise.resolve();
    this.#refresh = true;
    if (!this.#running)
      this.#running = this.#drain().finally(() => {
        this.#running = undefined;
      });
    return this.#running;
  }
  async #drain(): Promise<void> {
    do {
      this.#refresh = false;
      try {
        await this.#sweep();
      } catch {
        /* Auth/network recovery retries in the shell. */
      }
      // Requests arriving during I/O must get another complete sweep.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } while (this.#refresh && this.enabled && !this.#abort.signal.aborted);
  }
  async #claim(
    request: OperationRequest,
    handler: ClientOperationHandler,
    force = false,
  ): Promise<ClaimClientOperationResponse> {
    const executor = handler.executor();
    if (!executor || !sameBinding(executor, request.binding))
      throw new Error("Executor unavailable");
    const cached = this.#claims.get(request.attempt_id);
    if (!force && cached && Date.parse(cached.expires_at) > Date.now() + 5_000)
      return cached;
    const claim = await this.api.claim(request, executor, this.#abort.signal);
    this.#check();
    this.#claims.set(request.attempt_id, claim);
    this.#retried.delete(request.attempt_id);
    return claim;
  }
  /** The stream-end nudge can beat the generation's release after the park,
   * and the server refuses the claim until it lands. One early retry replaces
   * a wait for the poll; a claim refused again (another pane holds it, the
   * chat is archived) is the poll's to recover. */
  #retryClaim(id: string): void {
    if (this.#retried.has(id) || this.#abort.signal.aborted) return;
    this.#retried.add(id);
    this.#retry ??= setTimeout(() => {
      this.#retry = undefined;
      void this.reconcile();
    }, CLAIM_RETRY_MS);
  }
  async #sweep(): Promise<void> {
    const seen = new Set<string>();
    let after: string | undefined;
    let prepared = false;
    do {
      // Random UUID pagination is one sweep, never a persistent high-water mark.
      const page = await this.api.list(after, this.#abort.signal);
      this.#check();
      if (page.account_id !== this.accountId) {
        this.dispose();
        this.accountChanged();
        return;
      }
      // Before the durable early return: a stream may serve live calls alone.
      if (after === undefined) this.#syncStreams(page.executor_stream_enabled);
      this.enabled = page.enabled || page.executor_stream_enabled;
      if (!page.enabled) {
        this.#operations.clear();
        this.#claims.clear();
        this.#retried.clear();
        this.#handlers().forEach((handler) => handler.reset?.());
        return;
      }
      if (!prepared) {
        prepared = true;
        for (const handler of this.#handlers()) {
          try {
            await handler.prepare?.(this.#abort.signal);
          } catch {
            /* No native diagnostics leave the handler. */
          }
          this.#check();
        }
      }
      for (const operation of page.operations) {
        this.#check();
        const request = operation.request;
        if (request.account_id !== this.accountId) {
          this.dispose();
          this.accountChanged();
          return;
        }
        seen.add(request.attempt_id);
        this.#operations.set(request.attempt_id, operation);
        // A task's call is continued or expired by any of the user's clients,
        // so a closed pane never strands the task that waits on it.
        if (request.lineage && (await this.#settleGrantCall(operation)))
          continue;
        const handler = this.#handlerFor(request);
        // Unsupported kinds are discoverable but never claimed/executed.
        if (!handler) continue;
        if (
          (operation.state === "pending" || operation.state === "claimed") &&
          Date.parse(request.expires_at) <= Date.now()
        ) {
          // The server authors expiry; never manufacture an executor result.
          try {
            await this.api.continue(request.attempt_id, this.#abort.signal);
          } catch {
            /* Retry after auth/network recovery. */
          }
          continue;
        }
        if (operation.state === "ready" || operation.state === "continuing") {
          handler.status?.(request, "continuing");
          try {
            await handler.settled?.(request, this.#abort.signal);
          } catch {
            /* Receipt recovery can wait for the device. */
          }
          this.#check();
          try {
            await this.#continue(request, handler);
          } catch {
            /* Another view may own continuation. */
          }
          continue;
        }
        if (operation.state === "completed") continue;
        const executor = handler.executor();
        if (!executor || !sameBinding(executor, request.binding)) {
          handler.status?.(
            request,
            executor ? "another_device" : "unavailable",
          );
          continue;
        }
        if (handler.defer?.(request)) continue;
        if (request.lineage) {
          this.#startGrantRun(request, handler);
          continue;
        }
        if (request.kind === "client_tool.v1") {
          this.#queueOwnRun(request, handler);
          continue;
        }
        await withClientCallLock(request.message_id, request.tool_call_id, () =>
          this.#run(request, handler),
        );
      }
      after = page.after;
    } while (after);
    for (const id of this.#operations.keys())
      if (!seen.has(id)) {
        this.#operations.delete(id);
        this.#claims.delete(id);
        this.#retried.delete(id);
      }
    for (const handler of this.#handlers()) {
      handler.retain?.(seen);
      try {
        await handler.recover?.(this.#abort.signal);
      } catch {
        /* Bounded receipt recovery on the next sweep. */
      }
      this.#check();
    }
  }
  async #run(
    request: OperationRequest,
    handler: ClientOperationHandler,
  ): Promise<void> {
    let claim: ClaimClientOperationResponse;
    try {
      claim = await this.#claim(request, handler);
    } catch (error) {
      this.#claims.delete(request.attempt_id);
      if (isClaimRefusal(error)) this.#retryClaim(request.attempt_id);
      return;
    }
    // A prompt on the device can outlast a claim lease; it must never outlive
    // the claim its result needs.
    const held = this.#holdClaim(request, handler, claim);
    try {
      const result = await handler.execute(request, claim, held.signal);
      held.signal.throwIfAborted();
      if (!result) return;
      await this.api.complete(
        request,
        held.claim().claim_token,
        result,
        this.#abort.signal,
      );
      this.#check();
      try {
        await handler.settled?.(request, this.#abort.signal);
      } catch {
        /* Recover the durable receipt on reconnect. */
      }
      this.#check();
      handler.status?.(request, "continuing");
      await this.#continue(request, handler);
    } catch {
      this.#claims.delete(
        request.attempt_id,
      ); /* Never upload executor exceptions. */
    } finally {
      held.release();
    }
  }
  /**
   * Keeps `claim` while the handler works: re-claiming with the same binding
   * extends a live claim, and a lapsed one comes back with a new token, which
   * is the one the result must carry. A renewal lost on the way (a sleeping
   * laptop, a dropped network) or failed on the server is tried again while
   * the claim still holds; a refusal, a lapse or the attempt's end aborts the
   * returned signal at once. A renewal that does not move the claim's end (a
   * kind that keeps its lease, or a server without renewals) ends renewing,
   * and the claim lapses as it did before renewals.
   */
  #holdClaim(
    request: OperationRequest,
    handler: ClientOperationHandler,
    first: ClaimClientOperationResponse,
  ): HeldClaim {
    const controller = new AbortController();
    const stop = () => controller.abort();
    this.#abort.signal.addEventListener("abort", stop, { once: true });
    const attemptEnds = Date.parse(request.expires_at);
    const timers: ReturnType<typeof setTimeout>[] = [
      setTimeout(stop, Math.max(0, attemptEnds - Date.now())),
    ];
    let claim = first;
    let done = false;
    const renewLater = (retry = false) => {
      const claimEnds = Date.parse(claim.expires_at);
      if (done || claimEnds >= attemptEnds) return;
      const left = claimEnds - Date.now();
      const delay = retry
        ? Math.max(MIN_RENEWAL_MS, Math.min(RENEWAL_RETRY_MS, left / 2))
        : Math.max(MIN_RENEWAL_MS, left / 2);
      timers.push(
        setTimeout(() => {
          void this.#claim(request, handler, true).then(
            (renewed) => {
              const extended =
                Date.parse(renewed.expires_at) > Date.parse(claim.expires_at);
              claim = renewed;
              if (extended) renewLater();
            },
            (error: unknown) => {
              const holds = Date.parse(claim.expires_at) - Date.now();
              if (isRenewalNotRefused(error) && holds > MIN_RENEWAL_MS)
                renewLater(true);
              else stop();
            },
          );
        }, delay),
      );
    };
    renewLater();
    return {
      signal: controller.signal,
      claim: () => claim,
      release: () => {
        done = true;
        timers.forEach(clearTimeout);
        this.#abort.signal.removeEventListener("abort", stop);
      },
    };
  }
  /** Continues a task's call that has a result or has expired; true when
   * nothing is left for a handler to do. */
  async #settleGrantCall(operation: ClientOperationView): Promise<boolean> {
    const { request, state } = operation;
    if (state === "completed") return true;
    const expired =
      (state === "pending" || state === "claimed") &&
      Date.parse(request.expires_at) <= Date.now();
    if (!expired && state !== "ready" && state !== "continuing") return false;
    try {
      await this.api.continue(request.attempt_id, this.#abort.signal);
    } catch {
      /* Another client holds the continuation, or it retries next sweep. */
    }
    this.#check();
    return true;
  }
  /** A task's call may hold a prompt on the device for as long as its attempt
   * lives, so it runs beside the sweep instead of blocking it. */
  #startGrantRun(
    request: OperationRequest,
    handler: ClientOperationHandler,
  ): void {
    const id = request.attempt_id;
    if (this.#grantRuns.has(id)) return;
    this.#grantRuns.add(id);
    void withClientCallLock(request.message_id, request.tool_call_id, () =>
      this.#runGrantCall(request, handler),
    )
      .catch(() => {
        /* Retried on the next sweep. */
      })
      .finally(() => this.#grantRuns.delete(id));
  }
  /** A client tool call of the user's own turn can hold a prompt on the
   * device for as long as its claim is renewed, so it waits in a queue beside
   * the sweep, which runs them one at a time. Local evidence never waits on
   * the user and stays in the sweep, ahead of its receipt recovery. */
  #queueOwnRun(
    request: OperationRequest,
    handler: ClientOperationHandler,
  ): void {
    const id = request.attempt_id;
    if (this.#ownRuns.has(id)) return;
    this.#ownRuns.add(id);
    this.#ownQueue = this.#ownQueue
      .then(async () => {
        // Sweeps went on while it waited: the call may be settled or live
        // here, or its tool gone.
        const state = this.#operations.get(id)?.state;
        if (
          this.#abort.signal.aborted ||
          (state !== "pending" && state !== "claimed") ||
          this.#handlerFor(request) !== handler ||
          handler.defer?.(request)
        )
          return;
        await withClientCallLock(request.message_id, request.tool_call_id, () =>
          this.#run(request, handler),
        );
      })
      .catch(() => {
        /* Retried on the next sweep. */
      })
      .finally(() => this.#ownRuns.delete(id));
  }
  async #runGrantCall(
    request: OperationRequest,
    handler: ClientOperationHandler,
  ): Promise<void> {
    let held: HeldClaim | undefined;
    try {
      // The nudge after a task parks can beat the release of its generation,
      // as it can for a call of the user's own turn.
      const claim = await this.#claim(request, handler).catch(
        (error: unknown) => {
          if (isClaimRefusal(error)) this.#retryClaim(request.attempt_id);
          throw error;
        },
      );
      held = this.#holdClaim(request, handler, claim);
      const result = await handler.execute(request, claim, held.signal);
      held.signal.throwIfAborted();
      if (!result) {
        // The device could not serve the call (the app went away): the claim
        // lapses and a later sweep claims it afresh, so the call keeps waiting.
        this.#claims.delete(request.attempt_id);
        return;
      }
      await this.api.complete(
        request,
        held.claim().claim_token,
        result,
        this.#abort.signal,
      );
      this.#check();
      await this.api.continue(request.attempt_id, this.#abort.signal);
    } catch {
      this.#claims.delete(request.attempt_id);
    } finally {
      held?.release();
    }
  }
  async review(id: string): Promise<void> {
    const operation = this.#operations.get(id);
    const handler = operation && this.#handlerFor(operation.request);
    if (!operation || !handler) return;
    try {
      const claim = await this.#claim(operation.request, handler, true);
      this.#check();
      await handler.review?.(operation.request, claim, this.#abort.signal);
    } catch {
      /* Review errors stay local. */
    }
    await this.reconcile();
  }
  async cancel(id: string): Promise<void> {
    try {
      this.#check();
      await this.api.cancel(id, this.#abort.signal);
    } catch {
      return;
    }
    await this.reconcile();
  }
}
