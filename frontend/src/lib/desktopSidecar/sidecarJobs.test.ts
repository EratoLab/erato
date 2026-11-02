import {
  SIDECAR_PROVIDER,
  SidecarClientError,
  SidecarRpcError,
} from "@erato/desktop-sidecar-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  completedJob,
  fakeSidecarClient,
  fixtureDiscovery,
  JOB_HANDLE,
  NORMAL_MODE,
  pendingJob,
  PREVIOUS_SIDECAR,
  STRICT_MODE,
} from "./__tests__/sidecarJobTestUtils";
import {
  JOB_POLL_INTERVAL_MS,
  runSidecarJob,
  runsAsSidecarJob,
} from "./sidecarJobs";
import jobEnvelope from "../../../../desktop-sidecar-protocol/conformance/fixtures/job-envelope.json";
import jobsExample from "../../../../desktop-sidecar-protocol/examples/jobs.json";

import type { SidecarReply } from "./__tests__/sidecarJobTestUtils";
import type { JobCallResult } from "@erato/desktop-sidecar-protocol";

const TOOLS = SIDECAR_PROVIDER.tools.map((tool) => tool.name);
const normalMode = fixtureDiscovery(NORMAL_MODE);
const maxWaitMs = normalMode.jobs?.maxWaitMs ?? 0;
const exampleStart = jobsExample.messages[1].message as {
  result: { results: JobCallResult[] };
};
const [mailboxesResult, conversationError] = exampleStart.result.results;
const strictRefusal = jobEnvelope.statuses[1].results?.[1] as JobCallResult;

const at = (reply: SidecarReply, ms: number) =>
  new Promise<SidecarReply>((resolve) => setTimeout(() => resolve(reply), ms));

afterEach(() => {
  vi.useRealTimers();
});

describe("runsAsSidecarJob", () => {
  it("runs every built-in tool as a job on a sidecar in normal mode", () => {
    const { client } = fakeSidecarClient(() => completedJob([]), normalMode);
    for (const tool of TOOLS) expect(runsAsSidecarJob(client, tool)).toBe(true);
    expect(runsAsSidecarJob(client, "local_collect_evidence")).toBe(false);
  });

  it("keeps the direct RPCs for a sidecar without the job envelope", () => {
    const { client } = fakeSidecarClient(
      () => completedJob([]),
      fixtureDiscovery(PREVIOUS_SIDECAR),
    );
    for (const tool of TOOLS)
      expect(runsAsSidecarJob(client, tool)).toBe(false);
  });

  it("accepts additive discovery fields", () => {
    const { client } = fakeSidecarClient(
      () => completedJob([]),
      fixtureDiscovery(STRICT_MODE),
    );
    expect(runsAsSidecarJob(client, TOOLS[0])).toBe(true);
  });

  it.each([
    [
      "the provider is unavailable",
      {
        providers: normalMode.providers?.map((provider) => ({
          ...provider,
          available: false,
        })),
      },
    ],
    [
      "the provider does not list the tool",
      {
        providers: normalMode.providers?.map((provider) => ({
          ...provider,
          tools: provider.tools.filter((tool) => tool !== TOOLS[0]),
        })),
      },
    ],
    [
      "only another provider lists the tool",
      {
        providers: normalMode.providers?.map((provider) => ({
          ...provider,
          id: "local-mcp",
        })),
      },
    ],
    ["discovery reports no jobs", { jobs: undefined }],
  ])("keeps the direct RPCs when %s", (_case, change) => {
    const { client } = fakeSidecarClient(() => completedJob([]), {
      ...normalMode,
      ...change,
    });
    expect(runsAsSidecarJob(client, TOOLS[0])).toBe(false);
  });

  it.each(["jobs.start.v1", "jobs.status.v1"])(
    "keeps the direct RPCs while %s is not enabled",
    (method) => {
      const { client, supports } = fakeSidecarClient(
        () => completedJob([]),
        normalMode,
      );
      supports.mockImplementation((candidate) => candidate !== method);
      expect(runsAsSidecarJob(client, TOOLS[0])).toBe(false);
    },
  );
});

describe("runSidecarJob", () => {
  it("answers in one round trip when the job finishes within wait_ms, then acknowledges it", async () => {
    const { client, requests, methods } = fakeSidecarClient(
      (method) =>
        method === "jobs.start.v1"
          ? completedJob([mailboxesResult])
          : { result: { handle: JOB_HANDLE, state: "acked" } },
      normalMode,
    );
    await expect(
      runSidecarJob(client, "list_sidecar_mailboxes", {}),
    ).resolves.toEqual(
      (mailboxesResult as Extract<JobCallResult, { result: unknown }>).result,
    );
    expect(requests[0].params).toEqual({
      calls: [
        { server: "sidecar", name: "list_sidecar_mailboxes", arguments: {} },
      ],
      wait_ms: maxWaitMs,
    });
    await vi.waitFor(() =>
      expect(methods()).toEqual(["jobs.start.v1", "jobs.ack.v1"]),
    );
    expect(requests[1].params).toEqual({ handle: JOB_HANDLE });
  });

  it("long-polls jobs.status with wait_ms while the job runs", async () => {
    vi.useFakeTimers();
    const { client, requests, methods } = fakeSidecarClient((method) => {
      if (method === "jobs.start.v1") return at(pendingJob(), maxWaitMs);
      if (method === "jobs.status.v1")
        return at(completedJob([mailboxesResult]), 2_000);
      return { result: { handle: JOB_HANDLE, state: "acked" } };
    }, normalMode);
    const result = runSidecarJob(client, "list_sidecar_mailboxes", {});
    await vi.advanceTimersByTimeAsync(maxWaitMs);
    // A held start is followed at once by the next poll.
    expect(requests[1]).toMatchObject({
      method: "jobs.status.v1",
      params: { handle: JOB_HANDLE, wait_ms: maxWaitMs },
      at: requests[0].at + maxWaitMs,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(result).resolves.toMatchObject({
      structuredContent: { warnings: [] },
    });
    expect(methods()).toEqual([
      "jobs.start.v1",
      "jobs.status.v1",
      "jobs.ack.v1",
    ]);
  });

  it("falls back to the adaptive poll interval when the sidecar answers at once", async () => {
    vi.useFakeTimers();
    let polls = 0;
    const { client, requests } = fakeSidecarClient((method) => {
      if (method === "jobs.start.v1") return pendingJob("queued");
      if (method === "jobs.status.v1")
        return ++polls < 3 ? pendingJob() : completedJob([mailboxesResult]);
      return { result: { handle: JOB_HANDLE, state: "acked" } };
    }, normalMode);
    const result = runSidecarJob(client, "list_sidecar_mailboxes", {});
    await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS - 1);
    expect(requests.map(({ method }) => method)).toEqual(["jobs.start.v1"]);
    await vi.advanceTimersByTimeAsync(3 * JOB_POLL_INTERVAL_MS);
    await expect(result).resolves.toMatchObject({ structuredContent: {} });
    const start = requests[0].at;
    expect(
      requests
        .filter(({ method }) => method === "jobs.status.v1")
        .map(({ at }) => at - start),
    ).toEqual([1, 2, 3].map((n) => n * JOB_POLL_INTERVAL_MS));
  });

  it("polls without wait_ms when the sidecar holds no poll", async () => {
    vi.useFakeTimers();
    const { client, requests } = fakeSidecarClient(
      (method) => {
        if (method === "jobs.start.v1") return pendingJob();
        if (method === "jobs.status.v1") return completedJob([mailboxesResult]);
        return { result: { handle: JOB_HANDLE, state: "acked" } };
      },
      { ...normalMode, jobs: { maxCalls: 8, maxWaitMs: 0 } },
    );
    const result = runSidecarJob(client, "list_sidecar_mailboxes", {});
    await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
    await expect(result).resolves.toBeDefined();
    expect(requests[0].params).not.toHaveProperty("wait_ms");
    expect(requests[1]).toMatchObject({
      method: "jobs.status.v1",
      params: { handle: JOB_HANDLE },
      at: requests[0].at + JOB_POLL_INTERVAL_MS,
    });
    expect(requests[1].params).not.toHaveProperty("wait_ms");
  });

  it("cancels the job when the call is stopped", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { client, requests, methods } = fakeSidecarClient(
      (method) =>
        method === "jobs.status.v1"
          ? new Promise<SidecarReply>(() => undefined)
          : method === "jobs.start.v1"
            ? pendingJob()
            : { result: { handle: JOB_HANDLE, state: "cancelled" } },
      normalMode,
    );
    const result = runSidecarJob(
      client,
      "search_sidecar_index",
      { query: "report" },
      controller.signal,
    );
    const settled = result.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
    expect(methods()).toEqual(["jobs.start.v1", "jobs.status.v1"]);
    controller.abort();
    await expect(settled).resolves.toMatchObject({ kind: "aborted" });
    await vi.advanceTimersByTimeAsync(0);
    expect(
      requests.find(({ method }) => method === "jobs.cancel.v1")?.params,
    ).toEqual({ handle: JOB_HANDLE });
  });

  it("stops a paused poll when the call is stopped", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { client, methods } = fakeSidecarClient(
      (method) =>
        method === "jobs.start.v1"
          ? pendingJob()
          : { result: { handle: JOB_HANDLE, state: "cancelled" } },
      normalMode,
    );
    const settled = runSidecarJob(
      client,
      "list_sidecar_mailboxes",
      {},
      controller.signal,
    ).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await expect(settled).resolves.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
    expect(methods()).toEqual(["jobs.start.v1", "jobs.cancel.v1"]);
  });

  it.each([
    ["the protocol example's unknown mailbox", conversationError],
    ["a strict sidecar's refused content tool", strictRefusal],
  ])("throws %s as the direct RPC's error", async (_case, outcome) => {
    const { client, methods } = fakeSidecarClient(
      (method) =>
        method === "jobs.start.v1"
          ? completedJob([outcome])
          : { result: { handle: JOB_HANDLE, state: "acked" } },
      normalMode,
    );
    const { error } = outcome as Extract<JobCallResult, { error: unknown }>;
    const thrown = await runSidecarJob(
      client,
      "read_sidecar_conversation",
      {},
    ).catch((caught: unknown) => caught);
    expect(thrown).toBeInstanceOf(SidecarRpcError);
    expect(thrown).toEqual(
      new SidecarRpcError(error.code, error.message, error.data),
    );
    expect((thrown as SidecarRpcError).kind).toBe(
      new SidecarRpcError(error.code, error.message, error.data).kind,
    );
    await vi.waitFor(() => expect(methods()).toContain("jobs.ack.v1"));
  });

  it.each([
    ["expired", "transport_error"],
    ["failed", "sidecar_internal"],
    ["cancelled", "sidecar_internal"],
  ])("reports a job that ended as %s without results", async (state, kind) => {
    const { client, methods } = fakeSidecarClient(
      () => pendingJob(state),
      normalMode,
    );
    const thrown = await runSidecarJob(
      client,
      "list_sidecar_mailboxes",
      {},
    ).catch((caught: unknown) => caught);
    expect(thrown).toBeInstanceOf(SidecarClientError);
    expect(thrown).toMatchObject({ kind });
    expect(methods()).toEqual(["jobs.start.v1"]);
  });
});
