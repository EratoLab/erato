/* eslint-disable lingui/no-unlocalized-strings -- Protocol values and model-facing results. */
import { sourceProduct } from "./indexingSources";
import { outlookMailboxId } from "./mailboxAccess";
import { storeName } from "./outlookStores";

import type {
  DesktopSidecarClient,
  SourceCapabilities,
  SourcesListV1Result,
} from "@erato/desktop-sidecar-protocol";

type Source = SourcesListV1Result["sources"][number];

/** Product names as the model sees them in coverage and source notices. */
export const PRODUCT_LABELS: Record<string, string> = {
  outlook: "Outlook",
  teams: "Teams",
};

/** `error.data.sourceError` of a sidecar RPC error, when it names one. */
export function sidecarSourceError(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("data" in error))
    return undefined;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  const sourceError = (data as { sourceError?: unknown }).sourceError;
  return typeof sourceError === "string" && sourceError
    ? sourceError
    : undefined;
}

const SOURCE_ERROR_NOTICES: Record<string, string> = {
  document_not_found:
    "The item is no longer in the local index on this device. Search again for a current documentId; do not reuse this one.",
  missing_from_local_cache:
    "This item's content, or all of it but a preview, is not cached on this device, so it cannot be retrieved. Do not retry. Use the search hit's metadata and tell the user that the full content is not available on this device.",
  source_changed:
    "The item changed on this device since it was indexed. Search again and retry once with the new documentId.",
  unsupported_source:
    "This mailbox's storage format cannot provide this content. Do not retry; tell the user it is not available for this mailbox.",
  export_too_large:
    "The item is too large to retrieve in one piece. Do not retry it; for an email thread, retrieve single messages with subject_scope=subject.",
};

/** The model-facing explanation of a typed source error, if it is known. */
export function sourceErrorNotice(sourceError: string | undefined) {
  return sourceError ? SOURCE_ERROR_NOTICES[sourceError] : undefined;
}

/** A catalog source, as the chat tools apply its capabilities. */
export interface SidecarSourceInfo {
  sourceId: string;
  /** Compact mailbox ID, as Outlook RPCs use it. */
  mailboxId: string | null;
  product: string;
  /** Outlook store name for the model, e.g. "new Outlook for Mac". */
  store: string | null;
  /** Product and name, as search coverage labels a source. */
  label: string;
  /** Absent from older sidecars, which means unknown. */
  capabilities?: SourceCapabilities;
}

export interface SourceDirectory {
  sources: SidecarSourceInfo[];
  bySourceId: (sourceId: string | null | undefined) => SidecarSourceInfo[];
  byMailboxId: (mailboxId: string | null | undefined) => SidecarSourceInfo[];
}

function sourceInfo(source: Source): SidecarSourceInfo {
  let mailboxId: string | null = null;
  if (typeof source.locator.mailboxId === "string") {
    try {
      mailboxId = outlookMailboxId(source.locator.mailboxId);
    } catch {
      mailboxId = null;
    }
  }
  const product = sourceProduct(source);
  const name = source.displayName?.trim();
  const productLabel = PRODUCT_LABELS[product] ?? source.sourceKind;
  return {
    sourceId: source.sourceId,
    mailboxId,
    product,
    store: product === "outlook" ? storeName(source.sourceKind) : null,
    label: name ? `${productLabel} · ${name}` : productLabel,
    ...(source.capabilities && { capabilities: source.capabilities }),
  };
}

export function sourceDirectory(sources: readonly Source[]): SourceDirectory {
  const infos = sources.map(sourceInfo);
  const normalized = (id: string) => id.replaceAll("-", "").toLowerCase();
  return {
    sources: infos,
    bySourceId: (sourceId) =>
      sourceId
        ? infos.filter(
            (info) => normalized(info.sourceId) === normalized(sourceId),
          )
        : [],
    byMailboxId: (mailboxId) => {
      if (!mailboxId) return [];
      try {
        const compact = outlookMailboxId(mailboxId);
        return infos.filter((info) => info.mailboxId === compact);
      } catch {
        return [];
      }
    },
  };
}

/** The model-facing name of a source, with its Outlook, e.g. "Outlook · Jane (new Outlook for Mac)". */
export function sourceName(source: SidecarSourceInfo, label = source.label) {
  return source.store ? `${label} (${source.store})` : label;
}

/** True only when there are matching sources and every one reports the capability as missing. */
export function lacks(
  sources: readonly SidecarSourceInfo[],
  capability: "conversations" | "attachments" | "folders" | "recipients",
): boolean {
  return (
    sources.length > 0 &&
    sources.every((source) => source.capabilities?.[capability] === false)
  );
}

const SOURCE_DIRECTORY_TTL_MS = 30_000;

/**
 * Waits for a request shared by several tool calls. Cancelling one caller
 * stops only its wait, never the request the others depend on.
 */
export function untilAborted<T>(
  shared: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return shared;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    shared.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

/**
 * Lists the sidecar's sources at most every 30 seconds per sidecar instance.
 * Resolves to null when the sidecar cannot list them, so callers keep their
 * behavior for older sidecars.
 */
export function cachedSourceDirectory(client: DesktopSidecarClient) {
  let cache: {
    instanceId: string | null;
    at: number;
    directory: Promise<SourceDirectory | null>;
  } | null = null;
  return (signal?: AbortSignal): Promise<SourceDirectory | null> => {
    if (!client.supports("sources.list.v1")) return Promise.resolve(null);
    const { instanceId } = client.getSnapshot();
    const now = Date.now();
    if (
      cache?.instanceId !== instanceId ||
      now - cache.at >= SOURCE_DIRECTORY_TTL_MS
    ) {
      const directory = client
        .invoke("sources.list.v1", {})
        .then(({ sources }) => sourceDirectory(sources))
        .catch(() => {
          cache = null;
          return null;
        });
      cache = { instanceId, at: now, directory };
    }
    return untilAborted(cache.directory, signal);
  };
}
