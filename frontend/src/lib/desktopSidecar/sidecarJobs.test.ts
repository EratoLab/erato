import {
  SIDECAR_PROVIDER,
  SidecarClientError,
  SidecarRpcError,
} from "@erato/desktop-sidecar-protocol";
import { i18n } from "@lingui/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clientOperationHandlerRegistry } from "@/lib/clientOperations/handlers";
import { setClientPlatform } from "@/lib/clientPlatform";

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
  reopenSidecarReview,
  runSidecarJob,
  runsAsSidecarJob,
  SidecarReviewEndedError,
} from "./sidecarJobs";
import {
  askForReviewAgain,
  rememberReview,
  reviewLink,
  reviewLinkKey,
  useSidecarReviewLinks,
} from "./sidecarReviewLinks";
import { useSidecarReviewStore } from "./sidecarReviewStore";
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
const [mailboxesResult] = exampleStart.result.results;
const invalidArguments = jobEnvelope.statuses[2].results?.[2] as JobCallResult;
const strictMode = fixtureDiscovery(STRICT_MODE);

const at = (reply: SidecarReply, ms: number) =>
  new Promise<SidecarReply>((resolve) => setTimeout(() => resolve(reply), ms));

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  useSidecarReviewLinks.setState({ links: {} });
});

describe("runsAsSidecarJob", () => {
  it("runs every built-in tool as a job on a sidecar in normal mode", () => {
    const { client } = fakeSidecarClient(() => completedJob([]), normalMode);
    for (const tool of TOOLS) expect(runsAsSidecarJob(client, tool)).toBe(true);
    expect(runsAsSidecarJob(client, "fetch_availability")).toBe(false);
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

  it("never hands the turn off for a job that finishes without a review", async () => {
    vi.useFakeTimers();
    const onReview = vi.fn();
    const { client } = fakeSidecarClient((method) => {
      if (method === "jobs.start.v1") return pendingJob();
      if (method === "jobs.status.v1") return completedJob([mailboxesResult]);
      return { result: { handle: JOB_HANDLE, state: "acked" } };
    }, normalMode);
    const result = runSidecarJob(
      client,
      "search_sidecar_index",
      { query: "report" },
      { chatId: "chat", toolCallId: "call-1", onReview },
    );
    await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
    await expect(result).resolves.toBeDefined();
    expect(onReview).not.toHaveBeenCalled();
    expect(useSidecarReviewStore.getState().waitingByChatId.size).toBe(0);
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
      structuredContent: { "outlook.list_mailboxes.v1": expect.any(Object) },
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
      { signal: controller.signal },
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

  it("cancels the job when a status request fails", async () => {
    vi.useFakeTimers();
    const { client, requests } = fakeSidecarClient(
      (method) =>
        method === "jobs.status.v1"
          ? { error: { code: -32603, message: "Internal error." } }
          : method === "jobs.start.v1"
            ? pendingJob()
            : { result: { handle: JOB_HANDLE, state: "cancelled" } },
      normalMode,
    );
    const settled = runSidecarJob(client, "search_sidecar_index", {
      query: "report",
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
    await expect(settled).resolves.toBeInstanceOf(SidecarRpcError);
    await vi.advanceTimersByTimeAsync(0);
    expect(requests.map(({ method }) => method)).toEqual([
      "jobs.start.v1",
      "jobs.status.v1",
      "jobs.cancel.v1",
    ]);
    expect(requests[2].params).toEqual({ handle: JOB_HANDLE });
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
      { signal: controller.signal },
    ).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await expect(settled).resolves.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
    expect(methods()).toEqual(["jobs.start.v1", "jobs.cancel.v1"]);
  });

  it.each([["arguments the tool does not accept", invalidArguments]])(
    "throws a call's error for %s as the direct RPC's error",
    async (_case, outcome) => {
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
    },
  );

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

  describe("in strict mode", () => {
    const approved = {
      result: {
        handle: JOB_HANDLE,
        state: "approved",
        results: [mailboxesResult],
      },
    };
    const waiting = () => useSidecarReviewStore.getState().waitingByChatId;

    it("names this client and its language on the review request", async () => {
      vi.useFakeTimers();
      const locale = vi.spyOn(i18n, "locale", "get").mockReturnValue("de");
      setClientPlatform("outlook");
      document.documentElement.setAttribute("data-theme", "dark");
      document.documentElement.setAttribute("data-text-size", "large");
      try {
        const { client, requests } = fakeSidecarClient((method) => {
          if (method === "jobs.status.v1") return at(approved, maxWaitMs);
          if (method === "jobs.ack.v1")
            return { result: { handle: JOB_HANDLE, state: "acked" } };
          return pendingJob("ready_for_review");
        }, strictMode);
        const result = runSidecarJob(client, "search_sidecar_index", {
          query: "report",
        });
        await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS + maxWaitMs);
        await result;
        expect(
          requests.find(({ method }) => method === "jobs.review.v1")?.params,
        ).toEqual({
          handle: JOB_HANDLE,
          client: {
            platform: "outlook",
            locale: "de",
            theme_mode: "dark",
            text_size: "large",
          },
        });
      } finally {
        document.documentElement.removeAttribute("data-theme");
        document.documentElement.removeAttribute("data-text-size");
        setClientPlatform("web");
        locale.mockRestore();
      }
    });

    it("opens the native review once, keeps polling with wait_ms and returns the approved result", async () => {
      vi.useFakeTimers();
      let polls = 0;
      const { client, requests, methods } = fakeSidecarClient((method) => {
        if (method === "jobs.start.v1") return pendingJob("ready_for_review");
        if (method === "jobs.review.v1") return pendingJob("ready_for_review");
        if (method === "jobs.status.v1")
          return at(
            ++polls < 3 ? pendingJob("ready_for_review") : approved,
            maxWaitMs,
          );
        return { result: { handle: JOB_HANDLE, state: "acked" } };
      }, strictMode);
      const result = runSidecarJob(
        client,
        "search_sidecar_index",
        { query: "report" },
        { chatId: "task-chat" },
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(waiting()).toEqual(new Map([["task-chat", 1]]));
      await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS + 3 * maxWaitMs);
      await expect(result).resolves.toEqual(
        (mailboxesResult as Extract<JobCallResult, { result: unknown }>).result,
      );
      expect(methods()).toEqual([
        "jobs.start.v1",
        "jobs.review.v1",
        "jobs.status.v1",
        "jobs.status.v1",
        "jobs.status.v1",
        "jobs.ack.v1",
      ]);
      expect(requests[1].params).toEqual({
        handle: JOB_HANDLE,
        client: expect.objectContaining({ platform: "web" }),
      });
      for (const poll of requests.filter(
        ({ method }) => method === "jobs.status.v1",
      ))
        expect(poll.params).toEqual({ handle: JOB_HANDLE, wait_ms: maxWaitMs });
      expect(waiting().size).toBe(0);
    });

    it("hands the turn off once the review is open and waits for the decision without a deadline", async () => {
      vi.useFakeTimers();
      const decided = { now: false };
      const { client, methods } = fakeSidecarClient((method) => {
        if (method === "jobs.status.v1")
          return at(
            decided.now ? approved : pendingJob("ready_for_review"),
            maxWaitMs,
          );
        if (method === "jobs.ack.v1")
          return { result: { handle: JOB_HANDLE, state: "acked" } };
        return pendingJob("ready_for_review");
      }, strictMode);
      const onReview = vi.fn(() => {
        // The window was asked to open before the turn is handed off.
        expect(methods()).toEqual(["jobs.start.v1", "jobs.review.v1"]);
      });
      const result = runSidecarJob(
        client,
        "search_sidecar_index",
        { query: "report" },
        { chatId: "chat", toolCallId: "call-1", onReview },
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(onReview).toHaveBeenCalledTimes(1);
      expect(useSidecarReviewStore.getState().waitingByChatId.get("chat")).toBe(
        1,
      );
      // A quarter of an hour without a decision: still waiting, never cancelled.
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(onReview).toHaveBeenCalledTimes(1);
      expect(methods()).not.toContain("jobs.cancel.v1");
      decided.now = true;
      await vi.advanceTimersByTimeAsync(2 * maxWaitMs);
      await expect(result).resolves.toEqual(
        (mailboxesResult as Extract<JobCallResult, { result: unknown }>).result,
      );
      expect(methods().at(-1)).toBe("jobs.ack.v1");
      expect(useSidecarReviewStore.getState().waitingByChatId.size).toBe(0);
    });

    it.each(["declined", "cancelled", "expired"] as const)(
      "ends a review that ended as %s without results and stops waiting",
      async (state) => {
        vi.useFakeTimers();
        const { client, methods } = fakeSidecarClient((method) => {
          if (method === "jobs.status.v1") return pendingJob(state);
          return pendingJob("ready_for_review");
        }, strictMode);
        const settled = runSidecarJob(
          client,
          "read_sidecar_conversation",
          {},
          { chatId: "task-chat" },
        ).catch((caught: unknown) => caught);
        await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
        const thrown = await settled;
        expect(thrown).toBeInstanceOf(SidecarReviewEndedError);
        expect(thrown).toMatchObject({ state });
        expect(methods()).toEqual([
          "jobs.start.v1",
          "jobs.review.v1",
          "jobs.status.v1",
        ]);
        expect(waiting().size).toBe(0);
      },
    );

    it("stops waiting for the review when the call is stopped", async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const { client, methods } = fakeSidecarClient(
        (method) =>
          method === "jobs.status.v1"
            ? new Promise<SidecarReply>(() => undefined)
            : method === "jobs.cancel.v1"
              ? pendingJob("cancelled")
              : pendingJob("ready_for_review"),
        strictMode,
      );
      const settled = runSidecarJob(
        client,
        "read_sidecar_conversation",
        {},
        { signal: controller.signal, chatId: "task-chat" },
      ).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
      expect(methods()).toEqual([
        "jobs.start.v1",
        "jobs.review.v1",
        "jobs.status.v1",
      ]);
      expect(waiting().get("task-chat")).toBe(1);
      controller.abort();
      await expect(settled).resolves.toMatchObject({ kind: "aborted" });
      await vi.advanceTimersByTimeAsync(0);
      expect(methods()).toContain("jobs.cancel.v1");
      expect(waiting().size).toBe(0);
    });

    describe("a call run again after its page went away", () => {
      const key = reviewLinkKey("message-1", "call-1");
      const callOptions = {
        chatId: "chat",
        toolCallId: "call-1",
        messageId: "message-1",
      };

      it("records the job before the window opens and forgets it once decided", async () => {
        vi.useFakeTimers();
        const links: unknown[] = [];
        const { client } = fakeSidecarClient((method) => {
          if (method === "jobs.review.v1") links.push(reviewLink(key));
          if (method === "jobs.status.v1") return approved;
          if (method === "jobs.ack.v1")
            return { result: { handle: JOB_HANDLE, state: "acked" } };
          return pendingJob("ready_for_review");
        }, strictMode);
        const result = runSidecarJob(
          client,
          "search_sidecar_index",
          { query: "report" },
          callOptions,
        );
        await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
        await expect(result).resolves.toBeDefined();
        expect(links).toEqual([
          expect.objectContaining({ state: "open", handle: JOB_HANDLE }),
        ]);
        expect(reviewLink(key)).toBeUndefined();
      });

      it("names the call's chat and the chat it runs for on the job it records", async () => {
        vi.useFakeTimers();
        const links: unknown[] = [];
        const { client } = fakeSidecarClient((method) => {
          if (method === "jobs.review.v1") links.push(reviewLink(key));
          if (method === "jobs.status.v1") return approved;
          if (method === "jobs.ack.v1")
            return { result: { handle: JOB_HANDLE, state: "acked" } };
          return pendingJob("ready_for_review");
        }, strictMode);
        const result = runSidecarJob(
          client,
          "search_sidecar_index",
          { query: "report" },
          { ...callOptions, ownerChatId: "origin-chat" },
        );
        await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
        await expect(result).resolves.toBeDefined();
        expect(links).toEqual([
          expect.objectContaining({
            state: "open",
            chatIds: ["chat", "origin-chat"],
          }),
        ]);
      });

      it("forgets the job when the call is stopped, and keeps it after a failed poll", async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        let failPoll = false;
        const { client } = fakeSidecarClient((method) => {
          if (method === "jobs.status.v1")
            return failPoll
              ? { error: { code: -32000, message: "gone" } }
              : new Promise<SidecarReply>(() => undefined);
          if (method === "jobs.cancel.v1") return pendingJob("cancelled");
          return pendingJob("ready_for_review");
        }, strictMode);
        const stopped = runSidecarJob(
          client,
          "search_sidecar_index",
          { query: "report" },
          { ...callOptions, signal: controller.signal },
        ).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
        expect(reviewLink(key)).toMatchObject({ state: "open" });
        controller.abort();
        await expect(stopped).resolves.toBeDefined();
        expect(reviewLink(key)).toBeUndefined();

        failPoll = true;
        const failed = runSidecarJob(
          client,
          "search_sidecar_index",
          { query: "report" },
          callOptions,
        ).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
        await failed;
        expect(reviewLink(key)).toMatchObject({ state: "open" });
      });

      it("delivers a Share made while no page was open, with no new job and no window", async () => {
        rememberReview(key, JOB_HANDLE);
        const { client, requests, methods } = fakeSidecarClient(
          (method) =>
            method === "jobs.status.v1"
              ? approved
              : { result: { handle: JOB_HANDLE, state: "acked" } },
          strictMode,
        );
        await expect(
          runSidecarJob(
            client,
            "search_sidecar_index",
            { query: "report" },
            callOptions,
          ),
        ).resolves.toEqual(
          (mailboxesResult as Extract<JobCallResult, { result: unknown }>)
            .result,
        );
        expect(methods()).toEqual(["jobs.status.v1", "jobs.ack.v1"]);
        expect(requests[0].params).toEqual({ handle: JOB_HANDLE });
        expect(reviewLink(key)).toBeUndefined();
      });

      it("delivers a Decline made while no page was open, with no new job and no window", async () => {
        rememberReview(key, JOB_HANDLE);
        const { client, methods } = fakeSidecarClient(
          () => pendingJob("declined"),
          strictMode,
        );
        const thrown = await runSidecarJob(
          client,
          "search_sidecar_index",
          { query: "report" },
          callOptions,
        ).catch((caught: unknown) => caught);
        expect(thrown).toBeInstanceOf(SidecarReviewEndedError);
        expect(thrown).toMatchObject({ state: "declined" });
        expect(methods()).toEqual(["jobs.status.v1"]);
        expect(reviewLink(key)).toBeUndefined();
      });

      it("shows a review still open again, on the same job", async () => {
        vi.useFakeTimers();
        rememberReview(key, JOB_HANDLE);
        let polled = 0;
        const { client, methods, requests } = fakeSidecarClient((method) => {
          if (method === "jobs.status.v1")
            return ++polled === 1 ? pendingJob("ready_for_review") : approved;
          if (method === "jobs.ack.v1")
            return { result: { handle: JOB_HANDLE, state: "acked" } };
          return pendingJob("ready_for_review");
        }, strictMode);
        const result = runSidecarJob(
          client,
          "search_sidecar_index",
          { query: "report" },
          callOptions,
        );
        await vi.advanceTimersByTimeAsync(0);
        expect(methods()).toEqual(["jobs.status.v1", "jobs.review.v1"]);
        expect(requests[1].params).toMatchObject({ handle: JOB_HANDLE });
        await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
        await expect(result).resolves.toBeDefined();
        expect(methods()).not.toContain("jobs.start.v1");
      });

      it("reports a review whose hour ran out, and starts nothing until the user asks again", async () => {
        rememberReview(key, JOB_HANDLE);
        const { client, methods } = fakeSidecarClient(
          () => pendingJob("expired"),
          strictMode,
        );
        const thrown = await runSidecarJob(
          client,
          "search_sidecar_index",
          { query: "report" },
          callOptions,
        ).catch((caught: unknown) => caught);
        expect(thrown).toMatchObject({ state: "expired" });
        expect(methods()).toEqual(["jobs.status.v1"]);
        expect(reviewLink(key)?.state).toBe("ended");

        // Run again before the user asks: nothing starts.
        await runSidecarJob(
          client,
          "search_sidecar_index",
          { query: "report" },
          callOptions,
        ).catch((caught: unknown) => caught);
        expect(methods()).toEqual(["jobs.status.v1"]);
      });

      it("records that a review it was polling ended, for the user to ask again", async () => {
        vi.useFakeTimers();
        const { client } = fakeSidecarClient(
          (method) =>
            method === "jobs.status.v1"
              ? pendingJob("expired")
              : pendingJob("ready_for_review"),
          strictMode,
        );
        const settled = runSidecarJob(
          client,
          "search_sidecar_index",
          { query: "report" },
          callOptions,
        ).catch((caught: unknown) => caught);
        await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
        await expect(settled).resolves.toMatchObject({ state: "expired" });
        expect(reviewLink(key)?.state).toBe("ended");
      });

      it("starts one new review once the user asked again", async () => {
        vi.useFakeTimers();
        askForReviewAgain(key);
        const { client, methods } = fakeSidecarClient((method) => {
          if (method === "jobs.status.v1") return approved;
          if (method === "jobs.ack.v1")
            return { result: { handle: JOB_HANDLE, state: "acked" } };
          return pendingJob("ready_for_review");
        }, strictMode);
        const result = runSidecarJob(
          client,
          "search_sidecar_index",
          { query: "report" },
          callOptions,
        );
        await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
        await expect(result).resolves.toBeDefined();
        expect(methods().slice(0, 2)).toEqual([
          "jobs.start.v1",
          "jobs.review.v1",
        ]);
        expect(methods().filter((m) => m === "jobs.start.v1")).toHaveLength(1);
      });

      it.each(["cancelled", "failed", "acked"] as const)(
        "starts over when the remembered job ended as %s, with no decision to deliver",
        async (state) => {
          vi.useFakeTimers();
          rememberReview(key, JOB_HANDLE);
          let starts = 0;
          const { client, methods } = fakeSidecarClient((method) => {
            if (method === "jobs.start.v1") {
              starts += 1;
              return pendingJob("ready_for_review");
            }
            if (method === "jobs.status.v1")
              return starts === 0 ? pendingJob(state) : approved;
            if (method === "jobs.ack.v1")
              return { result: { handle: JOB_HANDLE, state: "acked" } };
            return pendingJob("ready_for_review");
          }, strictMode);
          const result = runSidecarJob(
            client,
            "search_sidecar_index",
            { query: "report" },
            callOptions,
          );
          await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
          await expect(result).resolves.toBeDefined();
          expect(methods().slice(0, 3)).toEqual([
            "jobs.status.v1",
            "jobs.start.v1",
            "jobs.review.v1",
          ]);
        },
      );
    });

    describe("reopenSidecarReview", () => {
      const key = reviewLinkKey("message-1", "call-1");

      it("shows the same job's review again and starts nothing", async () => {
        rememberReview(key, JOB_HANDLE);
        const { client, requests, methods } = fakeSidecarClient(
          () => pendingJob("ready_for_review"),
          strictMode,
        );
        await reopenSidecarReview(client, key);
        await reopenSidecarReview(client, key);
        expect(methods()).toEqual(["jobs.review.v1", "jobs.review.v1"]);
        expect(requests[0].params).toEqual({
          handle: JOB_HANDLE,
          client: expect.objectContaining({ platform: "web" }),
        });
      });

      it("opens nothing for a review already decided and lets the call's next run deliver it", async () => {
        rememberReview(key, JOB_HANDLE);
        const sweep = vi.fn();
        const unsubscribe = clientOperationHandlerRegistry.subscribe(sweep);
        const { client, methods } = fakeSidecarClient(
          () => pendingJob("declined"),
          strictMode,
        );
        try {
          await reopenSidecarReview(client, key);
        } finally {
          unsubscribe();
        }
        expect(methods()).toEqual(["jobs.review.v1"]);
        expect(sweep).toHaveBeenCalledTimes(1);
        expect(reviewLink(key)?.state).toBe("open");
      });

      it("says the review ended when the app no longer has it", async () => {
        rememberReview(key, JOB_HANDLE);
        const { client, methods } = fakeSidecarClient(
          () => pendingJob("expired"),
          strictMode,
        );
        await reopenSidecarReview(client, key);
        expect(reviewLink(key)?.state).toBe("ended");
        expect(methods()).toEqual(["jobs.review.v1"]);
      });

      it("does nothing for a call with no review to show", async () => {
        const { client, methods } = fakeSidecarClient(
          () => pendingJob("ready_for_review"),
          strictMode,
        );
        await reopenSidecarReview(client, key);
        expect(methods()).toEqual([]);
      });
    });
  });
});
