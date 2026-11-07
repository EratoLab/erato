import { SidecarClientError } from "@erato/desktop-sidecar-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import relayFixture from "../../../../desktop-sidecar-protocol/conformance/fixtures/desktop-ui-package-relay.json";

import type * as UiPackageRelay from "./uiPackageRelay";
import type {
  DesktopSidecarClient,
  SidecarDesktopUi,
  SidecarInstallUiPackageV1Params,
  SidecarInstallUiPackageV1Result,
  SidecarStatusV1Result,
  SidecarUiPackageStatus,
} from "@erato/desktop-sidecar-protocol";

const DIGEST = relayFixture.offeredDigest;
const TOKEN = "1762560000.c2VjcmV0LXRva2Vu";
const reference = {
  url: "https://app.erato.example/api/v1beta/desktop-sidecar/ui-package",
  token: TOKEN,
  digest: DIGEST,
  host_api: 1,
};
const archive = new Uint8Array(300_000).map((_, index) => (index * 7) % 256);

type StatusReply = SidecarStatusV1Result["ui_package"] | Error;
type InstallReply = SidecarInstallUiPackageV1Result | Error;

let relay: typeof UiPackageRelay;
let clock: number;
let controller: AbortController;
const sleep = vi.fn(async (delayMs: number, signal: AbortSignal) => {
  signal.throwIfAborted();
  clock += delayMs;
});

function failed(
  reason = "proxy",
  overrides: Partial<SidecarUiPackageStatus> = {},
): SidecarUiPackageStatus {
  return {
    state: "failed",
    digest: DIGEST,
    reason,
    attempted_at: "2026-11-07T10:15:00Z",
    relay: ["network", "proxy", "tls"].includes(reason),
    ...overrides,
  };
}

const current: SidecarUiPackageStatus = {
  state: "current",
  digest: DIGEST,
  attempted_at: null,
  relay: false,
};
const pending: SidecarUiPackageStatus = {
  state: "pending",
  digest: DIGEST,
  attempted_at: "2026-11-07T10:15:00Z",
  relay: false,
};

/** A client whose status replies run out into the last one. */
function fakeClient(
  statuses: StatusReply[] | (() => StatusReply),
  install: (
    params: SidecarInstallUiPackageV1Params,
  ) => InstallReply | Promise<SidecarInstallUiPackageV1Result> = () => ({
    state: "installed",
  }),
) {
  const installs: SidecarInstallUiPackageV1Params[] = [];
  const timeouts: (number | undefined)[] = [];
  let polls = 0;
  const invoke = vi.fn(
    async (
      method: string,
      params: unknown,
      options: { signal?: AbortSignal; timeoutMs?: number },
    ) => {
      options.signal?.throwIfAborted();
      if (method === "sidecar.status.v1") {
        const reply =
          typeof statuses === "function"
            ? statuses()
            : statuses[Math.min(polls, statuses.length - 1)];
        polls += 1;
        if (reply instanceof Error) throw reply;
        return {
          permissions: {},
          ...(reply === undefined ? {} : { ui_package: reply }),
        };
      }
      const chunk = params as SidecarInstallUiPackageV1Params;
      installs.push(chunk);
      timeouts.push(options.timeoutMs);
      const reply = install(chunk);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  );
  return {
    client: { invoke } as unknown as DesktopSidecarClient,
    installs,
    timeouts,
    statusPolls: () => polls,
  };
}

function archiveResponse(
  bytes: Uint8Array = archive,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(bytes.slice().buffer, {
    status: init.status ?? 200,
    headers: init.headers ?? { ETag: `"${DIGEST}"` },
  });
}

function run(
  client: DesktopSidecarClient,
  deps: Partial<UiPackageRelay.UiPackageRelayDeps> = {},
  signal: AbortSignal = controller.signal,
) {
  return relay.installUiPackageWhenRefused(client, reference, signal, {
    fetch: vi.fn(async () => archiveResponse()),
    locks: null,
    sleep,
    now: () => clock,
    ...deps,
  });
}

function nextChunk(
  chunk: SidecarInstallUiPackageV1Params,
): SidecarInstallUiPackageV1Result {
  return chunk.chunk_index < chunk.chunk_count - 1
    ? { state: "continue", next_chunk_index: chunk.chunk_index + 1 }
    : { state: "installed" };
}

/** Reports failed/proxy until the first chunk, pending during the upload, current once installed. */
function relayingSidecar(
  interrupt: (
    chunk: SidecarInstallUiPackageV1Params,
  ) => Error | undefined = () => undefined,
) {
  let started = false;
  let installed = false;
  return fakeClient(
    () => (installed ? current : started ? pending : failed()),
    (chunk) => {
      started = true;
      const reply = interrupt(chunk) ?? nextChunk(chunk);
      if (!(reply instanceof Error) && reply.state === "installed")
        installed = true;
      return reply;
    },
  );
}

/** Lets concurrent calls interleave without moving the clock. */
async function yieldingSleep(_delayMs: number, signal: AbortSignal) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  signal.throwIfAborted();
}

/** A relay aborted after chunk 0, which leaves its upload resumable in this page. */
async function abortAfterFirstChunk(fetch: typeof globalThis.fetch) {
  const first = fakeClient([failed()], (chunk) => {
    if (chunk.chunk_index === 0)
      return { state: "continue", next_chunk_index: 1 };
    controller.abort();
    return new SidecarClientError("aborted", "aborted");
  });
  await expect(run(first.client, { fetch })).rejects.toThrow();
  controller = new AbortController();
  return first;
}

function decode(chunk: SidecarInstallUiPackageV1Params): Uint8Array {
  return Uint8Array.from(globalThis.atob(chunk.content_base64), (char) =>
    char.charCodeAt(0),
  );
}

beforeEach(async () => {
  vi.resetModules();
  relay = await import("./uiPackageRelay");
  clock = 0;
  controller = new AbortController();
  sleep.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  for (const [message] of vi.mocked(console.warn).mock.calls)
    expect(String(message)).not.toContain(TOKEN);
  vi.restoreAllMocks();
});

describe("installUiPackageWhenRefused", () => {
  it("waits for the sidecar's own download and stops without fetching once it is current", async () => {
    const { client, installs } = fakeClient([pending, pending, current]);
    const fetch = vi.fn();
    await expect(run(client, { fetch })).resolves.toBe("current");
    expect(sleep.mock.calls.map(([delayMs]) => delayMs)).toEqual([
      1_000, 2_000,
    ]);
    expect(fetch).not.toHaveBeenCalled();
    expect(installs).toHaveLength(0);
  });

  it("relays a relay-eligible failure in chunks fetched with the package token", async () => {
    const { client, installs, timeouts } = fakeClient([failed()], (chunk) =>
      chunk.chunk_index < chunk.chunk_count - 1
        ? { state: "continue", next_chunk_index: chunk.chunk_index + 1 }
        : { state: "installed" },
    );
    const fetch = vi.fn(async () => archiveResponse());
    await expect(run(client, { fetch })).resolves.toBe("relayed");
    expect(fetch).toHaveBeenCalledWith(reference.url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      cache: "no-store",
      redirect: "error",
      credentials: "omit",
      signal: controller.signal,
    });
    expect(installs.map((chunk) => chunk.chunk_index)).toEqual([0, 1, 2]);
    expect(installs.map((chunk) => decode(chunk).byteLength)).toEqual([
      131_072, 131_072, 37_856,
    ]);
    expect(new Set(installs.map((chunk) => chunk.upload_id)).size).toBe(1);
    for (const chunk of installs)
      expect(chunk).toMatchObject({
        digest: DIGEST,
        total_bytes: 300_000,
        chunk_count: 3,
      });
    const relayed = new Uint8Array(300_000);
    installs.forEach((chunk) =>
      relayed.set(decode(chunk), chunk.chunk_index * 131_072),
    );
    expect(relayed).toEqual(archive);
    expect(timeouts).toEqual([30_000, 30_000, 120_000]);
  });

  it.each(relayFixture.status)(
    "decides whether to relay as the conformance fixture says: $name",
    async ({ result, relays }) => {
      const { client } = fakeClient([
        (result as SidecarStatusV1Result).ui_package,
        current,
      ]);
      const fetch = vi.fn(async () => archiveResponse());
      await run(client, { fetch });
      expect(fetch).toHaveBeenCalledTimes(relays ? 1 : 0);
    },
  );

  it.each([
    [
      "an ETag naming another digest",
      archiveResponse(archive, { headers: { ETag: `"${"0".repeat(64)}"` } }),
    ],
    ["no ETag", archiveResponse(archive, { headers: {} })],
    ["a 401", archiveResponse(new Uint8Array(0), { status: 401 })],
    [
      "a declared length over the cap",
      archiveResponse(archive, {
        headers: { ETag: `"${DIGEST}"`, "Content-Length": "9437185" },
      }),
    ],
    ["a body over the cap", archiveResponse(new Uint8Array(9_437_185))],
    ["an empty body", archiveResponse(new Uint8Array(0))],
  ])("uploads nothing for %s", async (_name, response) => {
    const { client, installs } = fakeClient([failed()]);
    await expect(
      run(client, { fetch: vi.fn(async () => response) }),
    ).resolves.toBe("failed");
    expect(installs).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a failure that cannot be relayed", failed("verification")],
    [
      "a failure of another digest",
      failed("network", { digest: "1".repeat(64) }),
    ],
    ["relay withheld", failed("proxy", { relay: false })],
  ])("reports %s as failed without fetching", async (_name, status) => {
    const { client } = fakeClient([status]);
    const fetch = vi.fn();
    await expect(run(client, { fetch })).resolves.toBe("failed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["a sidecar from before package 0.1.47", undefined],
    ["no offer yet", null],
    [
      "an unavailable status method",
      new SidecarClientError("capability_unavailable", "unavailable"),
    ],
  ])("skips %s", async (_name, status) => {
    const { client } = fakeClient([status]);
    await expect(run(client)).resolves.toBe("skipped");
  });

  it("keeps polling through transport errors and gives up after ten minutes", async () => {
    const { client, statusPolls } = fakeClient([
      new SidecarClientError("transport_error", "offline"),
      pending,
    ]);
    await expect(run(client)).resolves.toBe("failed");
    expect(clock).toBeLessThanOrEqual(600_000);
    expect(clock).toBeGreaterThan(570_000);
    expect(statusPolls()).toBeGreaterThan(2);
  });

  it("backs off while the sidecar is busy and retries the same chunk", async () => {
    let busy = 3;
    const { client, installs } = fakeClient([failed()], (chunk) =>
      busy-- > 0
        ? { state: "busy" }
        : chunk.chunk_index < 2
          ? { state: "continue", next_chunk_index: chunk.chunk_index + 1 }
          : { state: "installed" },
    );
    await expect(run(client)).resolves.toBe("relayed");
    expect(installs.map((chunk) => chunk.chunk_index)).toEqual([
      0, 0, 0, 0, 1, 2,
    ]);
    expect(sleep.mock.calls.map(([delayMs]) => delayMs)).toEqual([
      5_000, 10_000, 20_000,
    ]);
  });

  it("starts over when the sidecar asks for chunk 0 again", async () => {
    const answers: InstallReply[] = [
      { state: "continue", next_chunk_index: 1 },
      { state: "continue", next_chunk_index: 0 },
      { state: "continue", next_chunk_index: 1 },
      { state: "continue", next_chunk_index: 2 },
      { state: "installed" },
    ];
    const { client, installs } = fakeClient([failed()], () => answers.shift()!);
    await expect(run(client)).resolves.toBe("relayed");
    expect(installs.map((chunk) => chunk.chunk_index)).toEqual([0, 1, 0, 1, 2]);
  });

  it("retries a chunk three times after a transport error and then gives up", async () => {
    const { client, installs } = fakeClient(
      [failed()],
      () => new SidecarClientError("transport_error", "offline"),
    );
    await expect(run(client)).resolves.toBe("failed");
    expect(installs.map((chunk) => chunk.chunk_index)).toEqual([0, 0, 0, 0]);
    expect(sleep.mock.calls.map(([delayMs]) => delayMs)).toEqual([
      1_000, 2_000, 4_000,
    ]);
  });

  it.each([
    ["a refusal", { state: "refused", reason: "verification" }],
    ["an unknown state", { state: "queued" }],
    ["a chunk outside the archive", { state: "continue", next_chunk_index: 3 }],
  ])("stops at %s", async (_name, answer) => {
    const { client, installs } = fakeClient([failed()], () => answer);
    await expect(run(client)).resolves.toBe("failed");
    expect(installs).toHaveLength(1);
  });

  it("leaves the relay to the window that holds the lock and waits for its result", async () => {
    const { client } = fakeClient([failed(), pending, current]);
    const fetch = vi.fn();
    const request = vi.fn(
      async (
        _name: string,
        _options: LockOptions,
        callback: (lock: Lock | null) => unknown,
      ) => callback(null),
    );
    const locks = { request } as unknown as LockManager;
    await expect(run(client, { fetch, locks })).resolves.toBe("current");
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      relay.UI_PACKAGE_RELAY_LOCK,
      { ifAvailable: true },
      expect.any(Function),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("relays once the window that held the lock abandoned its upload", async () => {
    const { client, installs } = fakeClient([failed(), pending, failed()]);
    let granted = false;
    const request = vi.fn(
      async (
        name: string,
        _options: LockOptions,
        callback: (lock: Lock | null) => unknown,
      ) => {
        const lock = granted ? ({ name, mode: "exclusive" } as Lock) : null;
        granted = true;
        return callback(lock);
      },
    );
    const locks = { request } as unknown as LockManager;
    await expect(run(client, { locks })).resolves.toBe("relayed");
    expect(request).toHaveBeenCalledTimes(2);
    expect(installs).toHaveLength(1);
  });

  it("fetches and uploads inside the granted lock and releases it when done", async () => {
    let held = false;
    let heldAtFetch: boolean | undefined;
    const heldPerChunk: boolean[] = [];
    const { client } = fakeClient([failed()], (chunk) => {
      heldPerChunk.push(held);
      return nextChunk(chunk);
    });
    const fetch = vi.fn(async () => {
      heldAtFetch = held;
      return archiveResponse();
    });
    const request = vi.fn(
      async (
        name: string,
        _options: LockOptions,
        callback: (lock: Lock | null) => Promise<unknown>,
      ) => {
        held = true;
        try {
          return await callback({ name, mode: "exclusive" });
        } finally {
          held = false;
        }
      },
    );
    const locks = { request } as unknown as LockManager;
    await expect(run(client, { fetch, locks })).resolves.toBe("relayed");
    expect(heldAtFetch).toBe(true);
    expect(heldPerChunk).toEqual([true, true, true]);
    expect(held).toBe(false);
  });

  it("runs one relay per page while another call keeps polling until the package is current", async () => {
    const { client, installs } = relayingSidecar();
    const fetch = vi.fn(async () => archiveResponse());
    const deps = { fetch, sleep: yieldingSleep };
    await expect(
      Promise.all([run(client, deps), run(client, deps)]),
    ).resolves.toEqual(["relayed", "current"]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(installs.map((chunk) => chunk.chunk_index)).toEqual([0, 1, 2]);
  });

  it("lets a polling call of the page finish an upload whose relay was aborted", async () => {
    const first = new AbortController();
    const { client, installs } = relayingSidecar((chunk) => {
      if (chunk.chunk_index !== 1 || first.signal.aborted) return undefined;
      first.abort();
      return new SidecarClientError("aborted", "aborted");
    });
    const fetch = vi.fn(async () => archiveResponse());
    const deps = { fetch, sleep: yieldingSleep };
    const [aborted, finished] = await Promise.allSettled([
      run(client, deps, first.signal),
      run(client, deps),
    ]);
    expect(aborted.status).toBe("rejected");
    expect(finished).toEqual({ status: "fulfilled", value: "relayed" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(installs.map((chunk) => chunk.chunk_index)).toEqual([0, 1, 1, 2]);
    expect(new Set(installs.map((chunk) => chunk.upload_id)).size).toBe(1);
  });

  it("waits for an aborted relay of the page to unwind before resuming its upload", async () => {
    let release = (_reply: SidecarInstallUiPackageV1Result): void => undefined;
    const late = new Promise<SidecarInstallUiPackageV1Result>(
      (resolve) => (release = resolve),
    );
    const first = fakeClient([failed()], (chunk) =>
      chunk.chunk_index === 0 ? nextChunk(chunk) : late,
    );
    const fetch = vi.fn(async () => archiveResponse());
    const unwinding = run(first.client, { fetch });
    await vi.waitFor(() => expect(first.installs).toHaveLength(2));
    controller.abort();

    controller = new AbortController();
    const second = fakeClient([pending], nextChunk);
    const resumed = run(second.client, { fetch });
    await vi.waitFor(() => expect(second.statusPolls()).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(second.installs).toHaveLength(0);

    // The sidecar answers the aborted call's chunk 1 after all.
    release({ state: "continue", next_chunk_index: 2 });
    await expect(unwinding).rejects.toThrow();
    await expect(resumed).resolves.toBe("relayed");
    expect(fetch).toHaveBeenCalledOnce();
    expect(second.installs.map((chunk) => chunk.chunk_index)).toEqual([2]);
    expect(
      new Set(
        [...first.installs, ...second.installs].map((chunk) => chunk.upload_id),
      ).size,
    ).toBe(1);
  });

  it("stops polling and uploading when aborted", async () => {
    const watching = fakeClient([pending]);
    const abortingSleep = vi.fn(
      async (_delayMs: number, signal: AbortSignal) => {
        controller.abort();
        signal.throwIfAborted();
      },
    );
    await expect(
      run(watching.client, { sleep: abortingSleep }),
    ).rejects.toThrow();

    controller = new AbortController();
    const uploading = fakeClient([failed()], () => ({ state: "busy" }));
    await expect(
      run(uploading.client, { sleep: abortingSleep }),
    ).rejects.toThrow();
    expect(uploading.installs).toHaveLength(1);
  });

  it("resumes the upload of a relay restarted in the same page", async () => {
    const fetch = vi.fn(async () => archiveResponse());
    const first = await abortAfterFirstChunk(fetch);
    const second = fakeClient([pending], nextChunk);
    await expect(run(second.client, { fetch })).resolves.toBe("relayed");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(second.installs.map((chunk) => chunk.chunk_index)).toEqual([1, 2]);
    expect(
      new Set(
        [...first.installs, ...second.installs].map((chunk) => chunk.upload_id),
      ).size,
    ).toBe(1);
  });

  it("does not continue its upload while the sidecar reports an unknown state", async () => {
    const fetch = vi.fn(async () => archiveResponse());
    await abortAfterFirstChunk(fetch);
    const second = fakeClient([
      { ...pending, state: "receiving", relay: true },
      current,
    ]);
    await expect(run(second.client, { fetch })).resolves.toBe("current");
    expect(second.installs).toHaveLength(0);
  });
});

describe("supportsUiPackageRelay", () => {
  const ui: SidecarDesktopUi = { host_apis: [1], seed: null, installed: null };
  it.each([
    ["a sidecar hosting the desktop UI with both methods", ui, [], true],
    ["a sidecar hosting no desktop UI", undefined, [], false],
    [
      "a sidecar without the relay method",
      ui,
      ["sidecar.install_ui_package.v1"],
      false,
    ],
    ["a sidecar without the status method", ui, ["sidecar.status.v1"], false],
  ])("%s", (_name, desktopUi, missing: string[], expected) => {
    const client = { supports: (method: string) => !missing.includes(method) };
    expect(relay.supportsUiPackageRelay(client, desktopUi)).toBe(expected);
  });
});
