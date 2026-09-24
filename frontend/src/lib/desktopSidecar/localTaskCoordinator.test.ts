import { describe, expect, it, vi } from "vitest";

import { LocalTaskCoordinator } from "./localTaskCoordinator";

import type {
  CloudLocalJob,
  LocalTaskApi,
  LocalTaskView,
} from "./localTaskCoordinator";
import type {
  ApprovedLocalExport,
  DesktopSidecarClient,
} from "@erato/desktop-sidecar-protocol";

function fixture() {
  const binding = {
    backendOrigin: "https://app.example",
    accountId: "account",
    deviceId: "d".repeat(43),
    taskId: "task",
    jobId: "job",
    attemptId: "attempt",
    toolCallId: "call",
    planDigest: `sha256:${"a".repeat(64)}`,
  };
  const job: CloudLocalJob = {
    id: "job",
    chatId: "original-child",
    messageId: "message",
    state: "waiting_for_local_result",
    binding,
    plan: {
      operation: "collect_evidence",
      queryVariants: ["cloud-known query"],
      maxHits: 10,
      maxArtifacts: 2,
      maxBytes: 1024,
      executionSeconds: 60,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    },
    receipt: null,
    serverOutcome: null,
  };
  const approved: ApprovedLocalExport = {
    binding,
    exportId: "e".repeat(43),
    snapshotId: "s".repeat(43),
    grantId: "g".repeat(43),
    manifestDigest: `sha256:${"b".repeat(64)}`,
    approvedAt: Math.floor(Date.now() / 1000),
    expiresAt: job.plan.expiresAt,
    artifacts: [
      {
        artifactId: "a".repeat(43),
        filename: "APPROVED_SECRET.txt",
        mediaType: "text/plain",
        sha256: `sha256:${"c".repeat(64)}`,
        byteLength: 15,
        contentBase64: globalThis.btoa("APPROVED_SECRET"),
      },
    ],
  };
  let localState = "ready_for_review";
  const invoke = vi.fn(async (method: string) => {
    if (method === "local_contexts.challenge.v1")
      return {
        deviceId: binding.deviceId,
        challenge: "n".repeat(43),
        expiresAt: job.plan.expiresAt,
      };
    if (method === "local_contexts.bind.v1")
      return { contextHandle: "c".repeat(43), expiresAt: job.plan.expiresAt };
    if (method === "local_exports.read.v1") return approved;
    if (method === "local_exports.ack.v1") {
      localState = "acknowledged";
      return { handle: "h".repeat(43), state: localState };
    }
    if (method === "local_tasks.cancel.v1") {
      localState = "cancelled";
      return { handle: "h".repeat(43), state: localState };
    }
    return { handle: "h".repeat(43), state: localState };
  });
  const native = {
    invoke,
    getSnapshot: () => ({ state: "ready", strictLocalDelegation: true }),
    discover: vi.fn(),
  } as unknown as DesktopSidecarClient;
  const api = {
    pending: vi.fn(async () => ({
      enabled: true,
      accountId: "account",
      jobs: [globalThis.structuredClone(job)],
      next: null as string | null,
    })),
    context: vi.fn(async () => ({ assertion: "signed-context" })),
    claim: vi.fn(async () => ({
      job: globalThis.structuredClone(job),
      authorization: "signed-job",
    })),
    complete: vi.fn<LocalTaskApi["complete"]>(async () => {
      job.receipt = "durable-receipt";
      job.state = "awaiting_authenticated_resume";
      return { receipt: job.receipt };
    }),
    resume: vi.fn(async () => {}),
    cancel: vi.fn(async () => {
      job.serverOutcome = { status: "cancelled" };
      job.state = "completed";
    }),
  } satisfies LocalTaskApi;
  let views: LocalTaskView[] = [];
  const changed = vi.fn((next: LocalTaskView[]) => {
    views = next;
  });
  const accountChanged = vi.fn();
  const create = (client: DesktopSidecarClient | null = native) =>
    new LocalTaskCoordinator("account", client, api, changed, accountChanged);
  return {
    job,
    approved,
    api,
    native,
    invoke,
    create,
    changed,
    accountChanged,
    views: () => views,
    approve: () => {
      localState = "approved";
    },
  };
}
describe("durable shared local coordinator", () => {
  it("keeps private markers and native status out of every cloud write before consent", async () => {
    const f = fixture();
    const coordinator = f.create();
    await coordinator.reconcile();
    expect(f.views()[0].state).toBe("ready_for_review");
    expect(f.api.complete).not.toHaveBeenCalled();
    expect(f.api.resume).not.toHaveBeenCalled();
    expect(f.api.cancel).not.toHaveBeenCalled();
    expect(
      f.invoke.mock.calls.some(
        ([method]) => method === "local_exports.read.v1",
      ),
    ).toBe(false);
    expect(JSON.stringify(f.changed.mock.calls)).not.toContain("SECRET");
    expect(JSON.stringify(f.api.context.mock.calls)).not.toContain("handle");
    expect(JSON.stringify(f.api.claim.mock.calls)).not.toContain("handle");
    coordinator.dispose();
  });
  it("does not turn a secret-bearing native exception into diagnostics or automatic results", async () => {
    const f = fixture();
    f.invoke.mockRejectedValue(
      new Error("PRIVATE_SECRET subject filename trace"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const coordinator = f.create();
    await coordinator.reconcile();
    expect(f.views()[0].state).toBe("unavailable");
    expect(JSON.stringify(f.changed.mock.calls)).not.toContain(
      "PRIVATE_SECRET",
    );
    expect(f.api.complete).not.toHaveBeenCalled();
    expect(f.api.cancel).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    coordinator.dispose();
    warn.mockRestore();
    error.mockRestore();
  });
  it("recovers a lost completion response and acknowledges the same receipt after cloud completion", async () => {
    const f = fixture();
    f.approve();
    f.api.complete.mockImplementationOnce(async () => {
      f.job.receipt = "durable-receipt";
      f.job.state = "completed";
      throw new Error("lost response");
    });
    const first = f.create();
    await first.reconcile();
    first.dispose();
    const returned = f.create();
    await returned.reconcile();
    expect(f.api.complete).toHaveBeenCalledTimes(1);
    expect(f.api.complete.mock.calls[0][1]).toEqual(f.approved);
    expect(f.invoke).toHaveBeenCalledWith(
      "local_exports.ack.v1",
      expect.objectContaining({ receipt: "durable-receipt" }),
      expect.anything(),
    );
    expect(JSON.stringify(f.changed.mock.calls)).not.toContain(
      "APPROVED_SECRET",
    );
    returned.dispose();
  });
  it("does not upload a result that arrives after account/pane disposal", async () => {
    const f = fixture();
    f.approve();
    let release!: (value: ApprovedLocalExport) => void;
    const original = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation((method) =>
      method === "local_exports.read.v1"
        ? new Promise((resolve) => {
            release = resolve;
          })
        : original(method),
    );
    const coordinator = f.create();
    const pending = coordinator.reconcile();
    await vi.waitFor(() => expect(release).toBeDefined());
    coordinator.dispose();
    release(f.approved);
    await pending;
    expect(f.api.complete).not.toHaveBeenCalled();
  });
  it("resumes accepted cloud work without the original native device", async () => {
    const f = fixture();
    f.job.state = "awaiting_authenticated_resume";
    f.job.receipt = "durable-receipt";
    const coordinator = f.create(null);
    await coordinator.reconcile();
    expect(f.api.resume).toHaveBeenCalledWith("job", expect.any(AbortSignal));
    expect(f.invoke).not.toHaveBeenCalled();
    coordinator.dispose();
  });
  it("cancels by logical binding after a closed pane without starting another job", async () => {
    const f = fixture();
    const coordinator = f.create();
    await coordinator.cancel("job");
    expect(f.api.cancel).toHaveBeenCalledTimes(1);
    expect(f.invoke).toHaveBeenCalledWith(
      "local_tasks.cancel.v1",
      expect.objectContaining({ binding: f.job.binding, plan: f.job.plan }),
      expect.anything(),
    );
    expect(f.api.claim).not.toHaveBeenCalled();
    expect(
      f.invoke.mock.calls.some(([method]) => method === "local_tasks.start.v1"),
    ).toBe(false);
    coordinator.dispose();
  });
  it("rejects another device and an export whose account binding changed", async () => {
    const f = fixture();
    f.job.binding = { ...f.job.binding!, deviceId: "other-device" };
    const coordinator = f.create();
    await coordinator.reconcile();
    expect(f.views()[0].state).toBe("another_device");
    expect(f.api.claim).not.toHaveBeenCalled();
    coordinator.dispose();
    const g = fixture();
    g.approve();
    g.approved.binding = { ...g.approved.binding, accountId: "other-account" };
    const second = g.create();
    await second.reconcile();
    expect(g.api.complete).not.toHaveBeenCalled();
    second.dispose();
  });
  it("clears old account state before asking a different authenticated account for local context", async () => {
    const f = fixture();
    f.api.pending.mockResolvedValue({
      enabled: true,
      accountId: "other-account",
      jobs: [],
      next: null,
    });
    const coordinator = f.create();
    await coordinator.reconcile();
    expect(f.accountChanged).toHaveBeenCalledTimes(1);
    expect(f.views()).toEqual([]);
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it("coordinates separate views through exact server receipts and native idempotency", async () => {
    const f = fixture();
    f.approve();
    const a = f.create();
    const b = f.create();
    await Promise.all([a.reconcile(), b.reconcile()]);
    expect(f.api.complete).toHaveBeenCalled();
    expect(
      f.invoke.mock.calls.some(([method]) => method === "local_exports.ack.v1"),
    ).toBe(true);
    for (const call of f.api.complete.mock.calls)
      expect(call[1]).toEqual(f.approved);
    expect(
      f.invoke.mock.calls.filter(
        ([method]) => method === "local_tasks.start.v1",
      ),
    ).toHaveLength(2);
    expect(
      f.invoke.mock.calls.some(
        ([method]) => method === "local_tasks.review.v1",
      ),
    ).toBe(false);
    a.dispose();
    b.dispose();
  });
});

it("uses status for cached handles and does not resume an already continuing job", async () => {
  const f = fixture();
  const coordinator = f.create();
  await coordinator.reconcile();
  await coordinator.reconcile();
  expect(f.api.claim).toHaveBeenCalledTimes(1);
  expect(
    f.invoke.mock.calls.filter(([method]) => method === "local_tasks.start.v1"),
  ).toHaveLength(1);
  expect(
    f.invoke.mock.calls.filter(
      ([method]) => method === "local_tasks.status.v1",
    ),
  ).toHaveLength(1);
  f.job.state = "continuing";
  await coordinator.reconcile();
  expect(f.api.resume).not.toHaveBeenCalled();
  coordinator.dispose();
});
it("stops after cloud disablement", async () => {
  const f = fixture();
  f.api.pending.mockResolvedValue({
    enabled: false,
    accountId: "account",
    jobs: [],
    next: null,
  });
  const coordinator = f.create();
  await coordinator.reconcile();
  await coordinator.reconcile();
  expect(f.api.pending).toHaveBeenCalledTimes(1);
  expect(f.invoke).not.toHaveBeenCalled();
  expect(coordinator.enabled).toBe(false);
  coordinator.dispose();
});
it("leaves discovery and backoff to the provider", async () => {
  const f = fixture();
  vi.spyOn(f.native, "getSnapshot").mockReturnValue({
    ...f.native.getSnapshot(),
    state: "error",
    strictLocalDelegation: false,
  });
  const coordinator = f.create();
  await coordinator.reconcile();
  await coordinator.reconcile();
  expect(f.native.discover).not.toHaveBeenCalled();
  expect(f.invoke).not.toHaveBeenCalled();
  coordinator.dispose();
});
it("does not use an unavailable delegation declaration as consent or legacy fallback", async () => {
  const f = fixture();
  vi.spyOn(f.native, "getSnapshot").mockReturnValue({
    ...f.native.getSnapshot(),
    state: "ready",
    strictLocalDelegation: false,
    localDelegation: { enforcement: "unavailable" },
  });
  const coordinator = f.create();
  await coordinator.reconcile();
  await coordinator.review("job");
  expect(f.invoke).not.toHaveBeenCalled();
  expect(f.api.complete).not.toHaveBeenCalled();
  coordinator.dispose();
});
it("opens native review after fresh authorization and reconciles the approved package", async () => {
  const f = fixture();
  const coordinator = f.create();
  await coordinator.reconcile();
  const original = f.invoke.getMockImplementation()!;
  f.invoke.mockImplementation(async (method) => {
    if (method === "local_tasks.review.v1") f.approve();
    return original(method);
  });
  await coordinator.review("job");
  expect(f.api.claim).toHaveBeenCalledTimes(2);
  expect(f.invoke).toHaveBeenCalledWith(
    "local_tasks.review.v1",
    expect.objectContaining({ handle: "h".repeat(43) }),
    expect.anything(),
  );
  expect(f.api.complete).toHaveBeenCalledWith(
    "job",
    f.approved,
    expect.any(AbortSignal),
  );
  expect(f.api.resume).toHaveBeenCalledTimes(1);
  coordinator.dispose();
});
it("queues cancellation refresh behind an in-flight poll", async () => {
  const f = fixture();
  let release!: () => void;
  const stale = { ...f.job };
  f.api.pending.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            enabled: true,
            accountId: "account",
            jobs: [stale],
            next: null,
          });
      }),
  );
  const coordinator = f.create();
  const tick = coordinator.reconcile();
  const cancellation = coordinator.cancel("job");
  await vi.waitFor(() => expect(f.api.cancel).toHaveBeenCalledTimes(1));
  release();
  await Promise.all([tick, cancellation]);
  expect(f.api.pending).toHaveBeenCalledTimes(2);
  expect(f.invoke).toHaveBeenCalledWith(
    "local_tasks.cancel.v1",
    expect.objectContaining({ binding: f.job.binding }),
    expect.anything(),
  );
  expect(f.views()).toEqual([]);
  coordinator.dispose();
});
