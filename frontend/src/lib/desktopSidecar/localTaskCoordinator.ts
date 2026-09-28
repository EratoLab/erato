/* eslint-disable lingui/no-unlocalized-strings -- Internal protocol states and fixed, non-telemetry errors. */
import {
  ClientOperationCoordinator,
  clientOperationApi,
} from "@/lib/clientOperations/coordinator";
import { registerOperationExecutor } from "@/lib/clientOperations/registration";
import {
  fetchLocalDelegationContext,
  fetchLocalDelegationAuthorize,
  fetchLocalDelegationComplete,
  fetchLocalDelegationExportContext,
  fetchLocalDelegationReceipts,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type {
  ClientOperationApi,
  ClientOperationHandler,
  CoordinatorStatus,
} from "@/lib/clientOperations/coordinator";
import type {
  ClaimClientOperationResponse,
  ExecutorBinding,
  NativeJobResponse,
  OperationRequest,
  OperationResult,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type {
  ApprovedLocalExport,
  DesktopSidecarClient,
  LocalTaskBinding,
  LocalTaskPlan,
  LocalTaskStatus,
} from "@erato/desktop-sidecar-protocol";

export interface CloudLocalJob {
  id: string;
  chatId: string;
  messageId: string;
  state: NativeJobResponse["state"];
  binding: LocalTaskBinding;
  plan: LocalTaskPlan;
  receipt: string | null;
  serverOutcome: { status: "cancelled" | "expired" } | null;
}
export interface LocalTaskApi {
  context(
    deviceId: string,
    challenge: string,
    signal: AbortSignal,
  ): Promise<{ assertion: string }>;
  authorize(
    id: string,
    token: string,
    signal: AbortSignal,
  ): Promise<{ job: CloudLocalJob; authorization: string }>;
  complete(
    id: string,
    token: string,
    approved: ApprovedLocalExport,
    signal: AbortSignal,
  ): Promise<{ receipt: string; result: OperationResult }>;
  exportContext(
    id: string,
    signal: AbortSignal,
  ): Promise<{ job: CloudLocalJob; authorization: string }>;
  receipts(
    after: string | undefined,
    signal: AbortSignal,
  ): Promise<{ accountId: string; jobs: CloudLocalJob[]; after?: string }>;
}
function cloudJob(job: NativeJobResponse): CloudLocalJob {
  const first = job.plan.queryVariants.at(0);
  if (first === undefined) throw new Error("Invalid local task plan");
  return {
    ...job,
    plan: {
      ...job.plan,
      queryVariants: [first, ...job.plan.queryVariants.slice(1)],
    },
    receipt: job.receipt ?? null,
    serverOutcome: job.serverOutcome ?? null,
  };
}
export const localTaskApi: LocalTaskApi = {
  context: (deviceId, challenge, signal) =>
    fetchLocalDelegationContext({ body: { deviceId, challenge } }, signal),
  authorize: (id, claimToken, signal) =>
    fetchLocalDelegationAuthorize(
      { pathParams: { id }, body: { claimToken } },
      signal,
    ).then((response) => ({ ...response, job: cloudJob(response.job) })),
  complete: (id, claimToken, approved, signal) =>
    fetchLocalDelegationComplete(
      {
        pathParams: { id },
        body: { claimToken, package: approved },
      },
      signal,
    ),
  exportContext: (id, signal) =>
    fetchLocalDelegationExportContext({ pathParams: { id } }, signal).then(
      (response) => ({ ...response, job: cloudJob(response.job) }),
    ),
  receipts: (after, signal) =>
    fetchLocalDelegationReceipts({ queryParams: { after } }, signal).then(
      (response) => ({ ...response, jobs: response.jobs.map(cloudJob) }),
    ),
};
export type LocalTaskViewState =
  | LocalTaskStatus["state"]
  | CoordinatorStatus
  | "awaiting_authenticated_resume";
export interface LocalTaskView {
  id: string;
  chatId: string;
  messageId: string;
  state: LocalTaskViewState;
}
type Context = {
  contextHandle: string;
  expiresAt: number;
  deviceId: string;
  instanceId?: string | null;
};
function sameBinding(a: LocalTaskBinding, b: LocalTaskBinding): boolean {
  return (
    Object.keys(b).every(
      (key) =>
        a[key as keyof LocalTaskBinding] === b[key as keyof LocalTaskBinding],
    ) && Object.keys(a).length === Object.keys(b).length
  );
}

/** Native-only adapter: opaque handles/statuses stay here. Only the approved
 * read introduces plaintext, kept on the stack until authenticated completion. */
export class LocalEvidenceHandler implements ClientOperationHandler {
  readonly kind = "local_evidence.v1";
  readonly #views = new Map<string, LocalTaskView>();
  readonly #handles = new Map<string, string>();
  readonly #jobs = new Map<string, CloudLocalJob>();
  readonly #acknowledged = new Set<string>();
  readonly #unregister: () => void;
  #context: Context | undefined;
  #disposed = false;
  constructor(
    readonly accountId: string,
    private readonly native: DesktopSidecarClient | null,
    private readonly api: LocalTaskApi,
    private readonly changed: (views: LocalTaskView[]) => void,
    private readonly origin = globalThis.location.origin,
  ) {
    this.#unregister = registerOperationExecutor("local_collect_evidence", () =>
      this.executor(),
    );
  }
  reset(): void {
    this.#context = undefined;
    this.#views.clear();
    this.#handles.clear();
    this.#jobs.clear();
    this.#acknowledged.clear();
    this.#emit();
  }
  dispose(): void {
    this.#disposed = true;
    this.#unregister();
    this.reset();
  }
  #check(signal: AbortSignal): void {
    signal.throwIfAborted();
    if (this.#disposed) throw new Error("Disposed local handler");
  }
  #emit(): void {
    this.changed([...this.#views.values()]);
  }
  #view(
    id: string,
    chatId: string,
    messageId: string,
    state: LocalTaskViewState,
  ): void {
    if (this.#disposed) return;
    this.#views.set(id, { id, chatId, messageId, state });
    this.#emit();
  }
  status(request: OperationRequest, state: CoordinatorStatus): void {
    if (this.#acknowledged.has(request.attempt_id)) return;
    this.#view(request.attempt_id, request.chat_id, request.message_id, state);
  }
  retain(ids: Set<string>): void {
    for (const id of this.#views.keys())
      if (!ids.has(id)) {
        this.#views.delete(id);
        this.#handles.delete(id);
        this.#jobs.delete(id);
      }
    this.#emit();
  }
  executor(): ExecutorBinding | undefined {
    const snapshot = this.native?.getSnapshot();
    if (
      this.#disposed ||
      !this.#context ||
      this.#context.expiresAt <= Date.now() / 1000 + 15 ||
      snapshot?.state !== "ready" ||
      !snapshot.strictLocalDelegation ||
      snapshot.instanceId !== this.#context.instanceId
    )
      return undefined;
    return {
      device_id: this.#context.deviceId,
      realm: "desktop-sidecar",
      host_context: { kind: "origin", identity: this.origin },
    };
  }
  #client(): DesktopSidecarClient {
    if (!this.native) throw new Error("Local review unavailable");
    return this.native;
  }
  async prepare(signal: AbortSignal): Promise<void> {
    await this.#localContext(signal);
  }
  async #localContext(signal: AbortSignal): Promise<Context> {
    this.#check(signal);
    const client = this.#client();
    const snapshot = client.getSnapshot();
    if (snapshot.state !== "ready" || !snapshot.strictLocalDelegation) {
      this.#context = undefined;
      throw new Error("Local review unavailable");
    }
    if (this.executor() && this.#context) return this.#context;
    if (this.#context?.instanceId !== snapshot.instanceId)
      this.#handles.clear();
    this.#context = undefined;
    const challenge = await client.invoke(
      "local_contexts.challenge.v1",
      {},
      { signal },
    );
    this.#check(signal);
    const { assertion } = await this.api.context(
      challenge.deviceId,
      challenge.challenge,
      signal,
    );
    this.#check(signal);
    const bound = await client.invoke(
      "local_contexts.bind.v1",
      { assertion },
      { signal },
    );
    this.#check(signal);
    return (this.#context = {
      ...bound,
      deviceId: challenge.deviceId,
      instanceId: snapshot.instanceId,
    });
  }
  #checkJob(job: CloudLocalJob, context: Context): void {
    if (
      job.binding.accountId !== this.accountId ||
      job.binding.deviceId !== context.deviceId ||
      job.binding.jobId !== job.id ||
      job.binding.taskId !== job.chatId
    )
      throw new Error("Local binding mismatch");
  }
  async #start(
    job: CloudLocalJob,
    authorization: string,
    context: Context,
    signal: AbortSignal,
  ): Promise<LocalTaskStatus> {
    this.#checkJob(job, context);
    const local = await this.#client().invoke(
      "local_tasks.start.v1",
      {
        contextHandle: context.contextHandle,
        binding: job.binding,
        plan: job.plan,
        authorization,
      },
      { signal },
    );
    this.#check(signal);
    this.#handles.set(job.id, local.handle);
    this.#jobs.set(job.id, job);
    return local;
  }
  async execute(
    request: OperationRequest,
    claim: ClaimClientOperationResponse,
    signal: AbortSignal,
  ): Promise<OperationResult | undefined> {
    try {
      return await this.#execute(request, claim, signal);
    } catch {
      this.#context = undefined;
      this.#handles.delete(request.attempt_id);
      this.#check(signal);
      this.status(request, "unavailable");
      throw new Error("Local operation unavailable");
    }
  }
  async #execute(
    request: OperationRequest,
    claim: ClaimClientOperationResponse,
    signal: AbortSignal,
  ): Promise<OperationResult | undefined> {
    const context = await this.#localContext(signal);
    let job = this.#jobs.get(request.attempt_id);
    const handle = this.#handles.get(request.attempt_id);
    let local: LocalTaskStatus;
    if (job && handle) {
      local = await this.#client().invoke(
        "local_tasks.status.v1",
        { contextHandle: context.contextHandle, handle },
        { signal },
      );
      this.#check(signal);
    } else {
      const authorized = await this.api.authorize(
        request.attempt_id,
        claim.claim_token,
        signal,
      );
      this.#check(signal);
      job = authorized.job;
      if (job.id !== request.attempt_id)
        throw new Error("Operation binding mismatch");
      local = await this.#start(job, authorized.authorization, context, signal);
    }
    this.#view(job.id, job.chatId, job.messageId, local.state);
    if (local.state !== "approved") return undefined;
    const approved = await this.#client().invoke(
      "local_exports.read.v1",
      {
        contextHandle: context.contextHandle,
        handle: local.handle,
      },
      { signal },
    );
    this.#check(signal);
    if (!sameBinding(approved.binding, job.binding))
      throw new Error("Approved binding mismatch");
    const response = await this.api.complete(
      job.id,
      claim.claim_token,
      approved,
      signal,
    );
    this.#check(signal);
    return response.result;
  }
  async settled(request: OperationRequest, signal: AbortSignal): Promise<void> {
    if (this.#acknowledged.has(request.attempt_id)) return;
    const context = await this.#localContext(signal);
    const response = await this.api.exportContext(request.attempt_id, signal);
    this.#check(signal);
    await this.#ack(response.job, response.authorization, context, signal);
  }
  async #ack(
    job: CloudLocalJob,
    authorization: string,
    context: Context,
    signal: AbortSignal,
  ): Promise<void> {
    this.#checkJob(job, context);
    if (job.serverOutcome) {
      await this.#client().invoke(
        "local_tasks.cancel.v1",
        {
          contextHandle: context.contextHandle,
          binding: job.binding,
          plan: job.plan,
        },
        { signal },
      );
    } else if (job.receipt) {
      const handle =
        this.#handles.get(job.id) ??
        (await this.#start(job, authorization, context, signal)).handle;
      this.#check(signal);
      await this.#client().invoke(
        "local_exports.ack.v1",
        {
          contextHandle: context.contextHandle,
          handle,
          receipt: job.receipt,
        },
        { signal },
      );
    } else return;
    this.#check(signal);
    this.#acknowledged.add(job.id);
    this.#views.delete(job.id);
    this.#emit();
  }
  async recover(signal: AbortSignal): Promise<void> {
    if (!this.executor()) return;
    const context = await this.#localContext(signal);
    const seen = new Set<string>();
    let after: string | undefined;
    do {
      const page = await this.api.receipts(after, signal);
      this.#check(signal);
      if (page.accountId !== this.accountId) throw new Error("Account changed");
      for (const job of page.jobs) {
        seen.add(job.id);
        if (
          this.#acknowledged.has(job.id) ||
          job.binding.deviceId !== context.deviceId
        )
          continue;
        try {
          const authorized = await this.api.exportContext(job.id, signal);
          this.#check(signal);
          await this.#ack(
            authorized.job,
            authorized.authorization,
            context,
            signal,
          );
        } catch {
          this.#check(
            signal,
          ); /* Native denial stays local; renew context/handle on reconnect. */
          this.#context = undefined;
          this.#handles.delete(job.id);
        }
      }
      after = page.after;
    } while (after);
    for (const id of this.#acknowledged)
      if (!seen.has(id)) this.#acknowledged.delete(id);
  }
  async review(
    request: OperationRequest,
    claim: ClaimClientOperationResponse,
    signal: AbortSignal,
  ): Promise<void> {
    const context = await this.#localContext(signal);
    const authorized = await this.api.authorize(
      request.attempt_id,
      claim.claim_token,
      signal,
    );
    this.#check(signal);
    if (authorized.job.id !== request.attempt_id)
      throw new Error("Operation binding mismatch");
    const { handle } = await this.#start(
      authorized.job,
      authorized.authorization,
      context,
      signal,
    );
    await this.#client().invoke(
      "local_tasks.review.v1",
      { contextHandle: context.contextHandle, handle },
      { signal },
    );
    this.#check(signal);
  }
}

/** Shell composition: generic coordinator plus its first native handler. */
export class LocalTaskCoordinator extends ClientOperationCoordinator {
  constructor(
    accountId: string,
    native: DesktopSidecarClient | null,
    api: LocalTaskApi,
    changed: (views: LocalTaskView[]) => void,
    accountChanged: () => void,
    operations: ClientOperationApi = clientOperationApi,
  ) {
    super(
      accountId,
      operations,
      [new LocalEvidenceHandler(accountId, native, api, changed)],
      accountChanged,
    );
  }
}
