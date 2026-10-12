/* eslint-disable lingui/no-unlocalized-strings -- Internal operation states and fixed errors. */
import {
  fetchListClientOperations,
  fetchClaimClientOperation,
  fetchCompleteClientOperation,
  fetchContinueClientOperation,
  fetchCancelClientOperation,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { continueAttachedOperation } from "./attachedContinuation";
import { clientOperationHandlerRegistry } from "./handlers";
import { withClientCallLock } from "./operationLock";

import type { ClientOperationHandlerRegistry } from "./handlers";
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
  cancel(id: string, signal: AbortSignal): Promise<unknown>;
}
function headers(request: OperationRequest): Record<string, string> {
  return {
    "X-Erato-Client-Tools": request.operation_id.split("/").at(-1) ?? "",
    "X-Erato-Executor": JSON.stringify(request.binding),
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
function sameBinding(a: ExecutorBinding, b: ExecutorBinding): boolean {
  return (
    a.device_id === b.device_id &&
    a.realm === b.realm &&
    a.host_context?.kind === b.host_context?.kind &&
    a.host_context?.identity === b.host_context?.identity
  );
}

/** One account-scoped shell coordinator. Claims/results/continuations are
 * durable server authority; maps only avoid redundant work within this view. */
export class ClientOperationCoordinator {
  readonly #abort = new AbortController();
  readonly #operations = new Map<string, ClientOperationView>();
  readonly #claims = new Map<string, ClaimClientOperationResponse>();
  readonly #attached = new Set<string>();
  readonly #builtIns: readonly ClientOperationHandler[];
  readonly #unsubscribe: () => void;
  #running: Promise<void> | undefined;
  #refresh = false;
  enabled = true;
  constructor(
    readonly accountId: string,
    private readonly api: ClientOperationApi,
    builtIns: readonly ClientOperationHandler[],
    private readonly accountChanged: () => void,
    private readonly registry: ClientOperationHandlerRegistry = clientOperationHandlerRegistry,
  ) {
    this.#builtIns = builtIns;
    this.#unsubscribe = registry.subscribe(() => {
      void this.reconcile();
    });
  }
  dispose(): void {
    this.#abort.abort();
    this.#unsubscribe();
    this.#operations.clear();
    this.#claims.clear();
    this.#attached.clear();
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
  #continue(
    request: OperationRequest,
    handler: ClientOperationHandler,
  ): Promise<unknown> {
    const executor = handler.executor();
    if (
      request.kind === "client_tool.v1" &&
      request.consent === "none" &&
      executor &&
      sameBinding(executor, request.binding) &&
      this.api.attach
    ) {
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
    return claim;
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
      this.enabled = page.enabled;
      if (!page.enabled) {
        this.#operations.clear();
        this.#claims.clear();
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
        const handler = this.#handlerFor(request);
        // Unsupported kinds are discoverable but never claimed/executed.
        if (!handler) continue;
        if (
          (operation.state === "pending" || operation.state === "claimed") &&
          Date.parse(request.expires_at) <= Date.now()
        ) {
          // The server authors expiry; never manufacture an executor result.
          try {
            await this.#continue(request, handler);
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
    try {
      const claim = await this.#claim(request, handler);
      const result = await handler.execute(request, claim, this.#abort.signal);
      this.#check();
      if (!result) return;
      await this.api.complete(
        request,
        claim.claim_token,
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
