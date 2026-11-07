/* eslint-disable lingui/no-unlocalized-strings -- console diagnostics, no UI text. */
import {
  UI_PACKAGE_CHUNK_BYTES,
  UI_PACKAGE_MAX_ARCHIVE_BYTES,
} from "@erato/desktop-sidecar-protocol";

import type { UiPackageReference } from "@/providers/DesktopSidecarProvider";
import type {
  DesktopSidecarClient,
  SidecarDesktopUi,
  SidecarInstallUiPackageV1Result,
} from "@erato/desktop-sidecar-protocol";

export const UI_PACKAGE_RELAY_LOCK = "erato-desktop-ui-package-relay";

export type UiPackageRelayOutcome =
  | "current"
  | "relayed"
  | "failed"
  | "skipped";

export interface UiPackageRelayDeps {
  fetch?: typeof fetch;
  /** `null` runs without Web Locks; omitted, `navigator.locks` is used when present. */
  locks?: LockManager | null;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
}

type RelayClient = Pick<DesktopSidecarClient, "invoke">;

interface PendingUpload {
  digest: string;
  uploadId: string;
  bytes: Uint8Array;
  index: number;
  expiresAt: number;
}

/** Covers the sidecar's slowest direct attempt: a 15 s connect plus a 60 s and a 300 s request. */
const WATCH_BUDGET_MS = 10 * 60_000;
const WATCH_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];
const WATCH_INTERVAL_MS = 30_000;
const UPLOAD_LIFETIME_MS = 10 * 60_000;
const CHUNK_TIMEOUT_MS = 30_000;
const LAST_CHUNK_TIMEOUT_MS = 120_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
const BUSY_DELAY_MS = 5_000;
const MAX_BUSY_DELAY_MS = 60_000;
const DECLINED = Symbol("declined");

// A relay restarted in this page (the configure effect re-ran) resumes this
// upload, which the sidecar keeps for 120 s after its last chunk.
let pendingUpload: PendingUpload | undefined;
let activeRelay: { signal: AbortSignal; settled: Promise<void> } | undefined;

export function supportsUiPackageRelay(
  client: Pick<DesktopSidecarClient, "supports">,
  ui: SidecarDesktopUi | undefined,
): boolean {
  return (
    !!ui &&
    client.supports("sidecar.status.v1") &&
    client.supports("sidecar.install_ui_package.v1")
  );
}

/**
 * After a configure that carried `reference`: waits for the sidecar's own
 * download and relays the archive when the sidecar reports a relay-eligible
 * failure for that digest. Never throws, except on abort.
 */
export async function installUiPackageWhenRefused(
  client: RelayClient,
  reference: UiPackageReference,
  signal: AbortSignal,
  deps: UiPackageRelayDeps = {},
): Promise<UiPackageRelayOutcome> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? abortableDelay;
  const startedAt = now();
  for (let poll = 0; ; poll++) {
    if (poll > 0) {
      const delayMs = WATCH_DELAYS_MS[poll - 1] ?? WATCH_INTERVAL_MS;
      if (now() + delayMs - startedAt > WATCH_BUDGET_MS) return "failed";
      await sleep(delayMs, signal);
    }
    let status;
    try {
      ({ ui_package: status } = await client.invoke(
        "sidecar.status.v1",
        {},
        { signal },
      ));
    } catch (error: unknown) {
      signal.throwIfAborted();
      if (errorKind(error) === "capability_unavailable") return "skipped";
      continue;
    }
    if (!status) return "skipped";
    if (status.state === "current") return "current";
    const offered = status.digest === reference.digest;
    if (status.state === "failed") {
      if (status.relay !== true || !offered) return "failed";
    } else if (
      status.state !== "pending" ||
      !offered ||
      !resumableUpload(reference.digest, now)
    ) {
      // An upload this page started shows as pending; anything else waits.
      continue;
    }
    const outcome = await exclusively(signal, deps, () =>
      relay(client, reference, signal, { ...deps, now, sleep }),
    );
    // Another relay runs; a later poll shows its result or its abandoned upload.
    if (outcome !== DECLINED) return outcome;
  }
}

async function exclusively(
  signal: AbortSignal,
  deps: UiPackageRelayDeps,
  run: () => Promise<UiPackageRelayOutcome>,
): Promise<UiPackageRelayOutcome | typeof DECLINED> {
  const previous = activeRelay;
  if (previous && !previous.signal.aborted) return DECLINED;
  let settle = (): void => undefined;
  const entry = {
    signal,
    settled: new Promise<void>((resolve) => (settle = resolve)),
  };
  activeRelay = entry;
  try {
    // An aborted relay of this page still holds the lock until it unwinds.
    await previous?.settled;
    const locks =
      deps.locks === undefined
        ? ((globalThis.navigator.locks as LockManager | undefined) ?? null)
        : deps.locks;
    if (!locks) return await run();
    return (await locks.request(
      UI_PACKAGE_RELAY_LOCK,
      { ifAvailable: true },
      (lock) => (lock ? run() : DECLINED),
    )) as UiPackageRelayOutcome | typeof DECLINED;
  } finally {
    if (activeRelay === entry) activeRelay = undefined;
    settle();
  }
}

async function relay(
  client: RelayClient,
  reference: UiPackageReference,
  signal: AbortSignal,
  deps: Required<Pick<UiPackageRelayDeps, "now" | "sleep">> &
    UiPackageRelayDeps,
): Promise<UiPackageRelayOutcome> {
  let upload = resumableUpload(reference.digest, deps.now);
  if (!upload) {
    const bytes = await fetchArchive(
      reference,
      signal,
      deps.fetch ?? globalThis.fetch,
    );
    if (!bytes) return "failed";
    upload = pendingUpload = {
      digest: reference.digest,
      uploadId: newUploadId(),
      bytes,
      index: 0,
      expiresAt: deps.now() + UPLOAD_LIFETIME_MS,
    };
  }
  return sendChunks(client, upload, signal, deps);
}

async function sendChunks(
  client: RelayClient,
  upload: PendingUpload,
  signal: AbortSignal,
  { now, sleep }: Required<Pick<UiPackageRelayDeps, "now" | "sleep">>,
): Promise<UiPackageRelayOutcome> {
  const count = Math.ceil(upload.bytes.byteLength / UI_PACKAGE_CHUNK_BYTES);
  let invocations = 4 * count + 20;
  let busyDelayMs = BUSY_DELAY_MS;
  const invoke = async (): Promise<SidecarInstallUiPackageV1Result | null> => {
    const start = upload.index * UI_PACKAGE_CHUNK_BYTES;
    const params = {
      upload_id: upload.uploadId,
      digest: upload.digest,
      total_bytes: upload.bytes.byteLength,
      chunk_index: upload.index,
      chunk_count: count,
      content_base64: bytesToBase64(
        upload.bytes.subarray(start, start + UI_PACKAGE_CHUNK_BYTES),
      ),
    };
    const timeoutMs =
      upload.index === count - 1 ? LAST_CHUNK_TIMEOUT_MS : CHUNK_TIMEOUT_MS;
    for (let attempt = 0; ; attempt++) {
      if (invocations === 0) {
        warn("the upload needed too many requests");
        return null;
      }
      invocations -= 1;
      try {
        return await client.invoke("sidecar.install_ui_package.v1", params, {
          signal,
          timeoutMs,
        });
      } catch (error: unknown) {
        signal.throwIfAborted();
        const kind = errorKind(error);
        const retryMs = RETRY_DELAYS_MS[attempt];
        if ((kind !== "timeout" && kind !== "transport_error") || !retryMs) {
          warn(`the sidecar answered ${kind ?? "with an error"}`);
          return null;
        }
        await sleep(retryMs, signal);
      }
    }
  };

  while (now() < upload.expiresAt) {
    const result = await invoke();
    if (!result) return "failed";
    if (result.state === "installed") {
      pendingUpload = undefined;
      return "relayed";
    }
    if (result.state === "continue") {
      const next = result.next_chunk_index;
      if (next === undefined || next >= count) {
        warn("the sidecar asked for a chunk outside the archive");
        return "failed";
      }
      upload.index = next;
      busyDelayMs = BUSY_DELAY_MS;
    } else if (result.state === "busy") {
      await sleep(busyDelayMs, signal);
      busyDelayMs = Math.min(busyDelayMs * 2, MAX_BUSY_DELAY_MS);
    } else {
      pendingUpload = undefined;
      warn(`the sidecar refused it (${result.reason ?? result.state})`);
      return "failed";
    }
  }
  warn("the upload did not finish in time");
  return "failed";
}

async function fetchArchive(
  reference: UiPackageReference,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<Uint8Array | null> {
  try {
    const response = await fetchImpl(reference.url, {
      headers: { Authorization: `Bearer ${reference.token}` },
      cache: "no-store",
      redirect: "error",
      credentials: "omit",
      signal,
    });
    if (response.status !== 200) {
      warn(`the archive request answered ${response.status}`);
      return null;
    }
    // Another digest would fail verification and back the digest off for six hours.
    const etag = response.headers.get("ETag")?.replace(/^W\//, "");
    if (etag !== `"${reference.digest}"`) {
      warn("the archive is not the offered package");
      return null;
    }
    const declared = response.headers.get("Content-Length");
    if (declared !== null && Number(declared) > UI_PACKAGE_MAX_ARCHIVE_BYTES) {
      warn("the archive is too large");
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > UI_PACKAGE_MAX_ARCHIVE_BYTES
    ) {
      warn("the archive is empty or too large");
      return null;
    }
    return bytes;
  } catch (error: unknown) {
    signal.throwIfAborted();
    warn(
      `the archive could not be fetched (${error instanceof Error ? error.name : "error"})`,
    );
    return null;
  }
}

function resumableUpload(
  digest: string,
  now: () => number,
): PendingUpload | undefined {
  if (pendingUpload && now() >= pendingUpload.expiresAt)
    pendingUpload = undefined;
  return pendingUpload?.digest === digest ? pendingUpload : undefined;
}

function newUploadId(): string {
  const crypto = globalThis.crypto;
  // randomUUID exists only in secure contexts; a development origin may be http.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 8_192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  return globalThis.btoa(binary);
}

function errorKind(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "kind" in error
    ? String(error.kind)
    : undefined;
}

function warn(detail: string): void {
  console.warn(
    `The desktop UI package was not relayed to the desktop sidecar: ${detail}.`,
  );
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
