/* eslint-disable lingui/no-unlocalized-strings -- Internal protocol states and fixed, non-telemetry errors. */
import { v1betaApiFetch } from "@/lib/generated/v1betaApi/v1betaApiFetcher";

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
  state: string;
  binding: LocalTaskBinding | null;
  plan: LocalTaskPlan;
  receipt: string | null;
  serverOutcome: { status: "cancelled" | "expired" } | null;
}
export interface LocalTaskApi {
  pending(
    after: string | undefined,
    signal: AbortSignal,
  ): Promise<{
    enabled: boolean;
    accountId: string;
    jobs: CloudLocalJob[];
    next: string | null;
  }>;
  context(
    deviceId: string,
    challenge: string,
    signal: AbortSignal,
  ): Promise<{ assertion: string }>;
  claim(
    id: string,
    deviceId: string,
    signal: AbortSignal,
  ): Promise<{ job: CloudLocalJob; authorization: string }>;
  complete(
    id: string,
    approved: ApprovedLocalExport,
    signal: AbortSignal,
  ): Promise<{ receipt: string }>;
  resume(id: string, signal: AbortSignal): Promise<unknown>;
  cancel(id: string, signal: AbortSignal): Promise<unknown>;
}
function request<T>(
  path: string,
  method: string,
  signal: AbortSignal,
  body?: object,
): Promise<T> {
  return v1betaApiFetch<T, unknown, object | undefined, object, object, object>(
    { url: `/api/v1beta/me/local-delegation/${path}`, method, signal, body },
  );
}
export const localTaskApi: LocalTaskApi = {
  pending: (after, signal) =>
    request(
      `jobs${after ? `?after=${encodeURIComponent(after)}` : ""}`,
      "GET",
      signal,
    ),
  context: (deviceId, challenge, signal) =>
    request("context", "POST", signal, { deviceId, challenge }),
  claim: (id, deviceId, signal) =>
    request(`jobs/${encodeURIComponent(id)}/claim`, "POST", signal, {
      deviceId,
    }),
  complete: (id, approved, signal) =>
    request(
      `jobs/${encodeURIComponent(id)}/complete`,
      "POST",
      signal,
      approved,
    ),
  resume: (id, signal) =>
    request(`jobs/${encodeURIComponent(id)}/resume`, "POST", signal),
  cancel: (id, signal) =>
    request(`jobs/${encodeURIComponent(id)}/cancel`, "POST", signal),
};
export type LocalTaskViewState =
  | LocalTaskStatus["state"]
  | "unavailable"
  | "another_device"
  | "awaiting_authenticated_resume"
  | "continuing";
export interface LocalTaskView {
  id: string;
  chatId: string;
  messageId: string;
  state: LocalTaskViewState;
}
type Context = { contextHandle: string; expiresAt: number; deviceId: string };
function sameBinding(a: LocalTaskBinding, b: LocalTaskBinding): boolean {
  return (
    Object.keys(b).every(
      (key) =>
        a[key as keyof LocalTaskBinding] === b[key as keyof LocalTaskBinding],
    ) && Object.keys(a).length === Object.keys(b).length
  );
}
/** One shell instance, independent of the selected chat. All authority and
 * deduplication live in PostgreSQL/native SQLite; this map is only a view cache.
 * Native errors and lifecycle changes are NEVER arguments to a cloud API.
 */
export class LocalTaskCoordinator {
  readonly #abort = new AbortController();
  readonly #views = new Map<string, LocalTaskView>();
  readonly #jobs = new Map<string, CloudLocalJob>();
  readonly #handles = new Map<string, string>();
  readonly #acknowledged = new Set<string>();
  #context: Context | undefined;
  #reconciling = false;
  constructor(
    readonly accountId: string,
    private readonly native: DesktopSidecarClient | null,
    private readonly api: LocalTaskApi,
    private readonly changed: (views: LocalTaskView[]) => void,
    private readonly accountChanged: () => void,
  ) {}
  dispose(): void {
    this.#abort.abort();
    this.#context = undefined;
    this.#handles.clear();
    this.#jobs.clear();
    this.#views.clear();
    this.#acknowledged.clear();
  }
  #check(): void {
    this.#abort.signal.throwIfAborted();
  }
  #emit(): void {
    if (!this.#abort.signal.aborted) this.changed([...this.#views.values()]);
  }
  #view(job: CloudLocalJob, state: LocalTaskViewState): void {
    this.#views.set(job.id, {
      id: job.id,
      chatId: job.chatId,
      messageId: job.messageId,
      state,
    });
    this.#emit();
  }
  async #localContext(): Promise<Context> {
    this.#check();
    if (this.native && this.native.getSnapshot().state !== "ready")
      await this.native.discover(this.#abort.signal);
    this.#check();
    if (
      !this.native?.getSnapshot().strictLocalDelegation ||
      this.native.getSnapshot().state !== "ready"
    )
      throw new Error("Local review unavailable");
    if (this.#context && this.#context.expiresAt > Date.now() / 1000 + 15)
      return this.#context;
    const options = { signal: this.#abort.signal };
    const challenge = await this.native.invoke(
      "local_contexts.challenge.v1",
      {},
      options,
    );
    this.#check();
    const { assertion } = await this.api.context(
      challenge.deviceId,
      challenge.challenge,
      this.#abort.signal,
    );
    this.#check();
    const bound = await this.native.invoke(
      "local_contexts.bind.v1",
      { assertion },
      options,
    );
    this.#check();
    return (this.#context = { ...bound, deviceId: challenge.deviceId });
  }
  #nativeClient(): DesktopSidecarClient {
    if (!this.native) throw new Error("Local sidecar unavailable");
    return this.native;
  }
  async #claim(
    job: CloudLocalJob,
    context: Context,
  ): Promise<{
    job: CloudLocalJob;
    handle: string;
    state: LocalTaskStatus["state"];
  }> {
    const claimed = await this.api.claim(
      job.id,
      context.deviceId,
      this.#abort.signal,
    );
    this.#check();
    const binding = claimed.job.binding;
    if (
      binding?.accountId !== this.accountId ||
      binding.deviceId !== context.deviceId ||
      binding.jobId !== job.id
    )
      throw new Error("Local account binding changed");
    const local = await this.#nativeClient().invoke(
      "local_tasks.start.v1",
      {
        contextHandle: context.contextHandle,
        binding,
        plan: claimed.job.plan,
        authorization: claimed.authorization,
      },
      { signal: this.#abort.signal },
    );
    this.#check();
    this.#handles.set(job.id, local.handle);
    this.#jobs.set(job.id, claimed.job);
    return { job: claimed.job, ...local };
  }
  async reconcile(): Promise<void> {
    if (this.#reconciling || this.#abort.signal.aborted) return;
    this.#reconciling = true;
    try {
      const seen = new Set<string>();
      let after: string | undefined;
      do {
        const page = await this.api.pending(after, this.#abort.signal);
        this.#check();
        if (page.accountId !== this.accountId) {
          this.dispose();
          this.changed([]);
          this.accountChanged();
          return;
        }
        if (!page.enabled) {
          this.#views.clear();
          this.#emit();
          return;
        }
        for (const job of page.jobs) {
          this.#check();
          seen.add(job.id);
          this.#jobs.set(job.id, job);
          // An authenticated returning frontend can resume already accepted work
          // even when the original native device is disconnected.
          if (
            job.state === "awaiting_authenticated_resume" ||
            job.state === "continuing"
          ) {
            this.#view(job, job.state);
            try {
              await this.api.resume(job.id, this.#abort.signal);
            } catch {
              /* Another frontend view may already have resumed this job. */
            }
          }
          if (job.state === "completed") this.#views.delete(job.id);
          if (this.#acknowledged.has(job.id)) continue;
          try {
            await this.#reconcileNative(job);
          } catch {
            this.#check();
            this.#context = undefined;
            if (job.state === "waiting_for_local_result")
              this.#view(job, "unavailable");
            // Do not log, cache or POST native exceptions or error payloads.
          }
        }
        after = page.next ?? undefined;
      } while (after);
      for (const id of this.#jobs.keys())
        if (!seen.has(id)) {
          this.#views.delete(id);
          this.#jobs.delete(id);
          this.#handles.delete(id);
          this.#acknowledged.delete(id);
        }
      this.#emit();
    } catch {
      /* Authentication/connection recovery is retried by the shell. */
    } finally {
      this.#reconciling = false;
    }
  }
  async #reconcileNative(original: CloudLocalJob): Promise<void> {
    const context = await this.#localContext();
    this.#check();
    if (original.binding && original.binding.deviceId !== context.deviceId) {
      if (original.state === "waiting_for_local_result")
        this.#view(original, "another_device");
      return;
    }
    if (original.serverOutcome) {
      if (original.binding)
        await this.#nativeClient().invoke(
          "local_tasks.cancel.v1",
          {
            contextHandle: context.contextHandle,
            binding: original.binding,
            plan: original.plan,
          },
          { signal: this.#abort.signal },
        );
      this.#acknowledged.add(original.id);
      this.#views.delete(original.id);
      return;
    }
    const { job, handle, state } = await this.#claim(original, context);
    const params = { contextHandle: context.contextHandle, handle };
    if (job.receipt) {
      await this.#nativeClient().invoke(
        "local_exports.ack.v1",
        { ...params, receipt: job.receipt },
        { signal: this.#abort.signal },
      );
      this.#check();
      this.#acknowledged.add(job.id);
      this.#views.delete(job.id);
      return;
    }
    this.#view(job, state);
    if (state !== "approved") return;
    // Only this native-authorized read can introduce evidence into JS memory.
    // Keep its package on the stack, out of React/query/local-answer caches.
    const approved = await this.#nativeClient().invoke(
      "local_exports.read.v1",
      params,
      { signal: this.#abort.signal },
    );
    this.#check();
    if (!job.binding || !sameBinding(approved.binding, job.binding))
      throw new Error("Approved binding mismatch");
    const { receipt } = await this.api.complete(
      job.id,
      approved,
      this.#abort.signal,
    );
    this.#check();
    await this.#nativeClient().invoke(
      "local_exports.ack.v1",
      { ...params, receipt },
      { signal: this.#abort.signal },
    );
    this.#check();
    this.#acknowledged.add(job.id);
    this.#view(job, "awaiting_authenticated_resume");
    await this.api.resume(job.id, this.#abort.signal);
  }
  async review(id: string): Promise<void> {
    try {
      const job = this.#jobs.get(id);
      if (!job) return;
      const context = await this.#localContext();
      // Reauthorize on the cloud before opening review, including account changes
      // that occurred since the last background poll. This sends no native status.
      const { handle } = await this.#claim(job, context);
      this.#check();
      await this.#nativeClient().invoke(
        "local_tasks.review.v1",
        { contextHandle: context.contextHandle, handle },
        { signal: this.#abort.signal },
      );
    } catch {
      /* Fixed local UI status only; never forward a native exception. */
    }
    await this.reconcile();
  }
  async cancel(id: string): Promise<void> {
    try {
      this.#check();
      // Explicit user intent is cloud-known. Native status/decline never invokes it.
      await this.api.cancel(id, this.#abort.signal);
    } catch {
      return;
    }
    await this.reconcile();
  }
}
