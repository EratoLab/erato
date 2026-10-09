/* eslint-disable lingui/no-unlocalized-strings -- Protocol values and model-facing results. */
import { outlookMailboxId } from "./mailboxAccess";

import type {
  DesktopSidecarClient,
  SourceCapabilities,
  SourcesListV1Result,
} from "@erato/desktop-sidecar-protocol";

type Source = SourcesListV1Result["sources"][number];

export type OutlookStoreVariant =
  | "newOutlookForMac"
  | "newOutlookForWindows"
  | "classic";

/**
 * The Outlook a source or mailbox belongs to, from its catalog `sourceKind`
 * or its `outlook.list_mailboxes.v1` `source`.
 */
export function outlookStoreVariant(
  kindOrSource: string | undefined,
): OutlookStoreVariant | null {
  const value = kindOrSource?.trim().toLowerCase().replaceAll(" ", "");
  if (!value) return null;
  if (value === "macoshxaccount") return "newOutlookForMac";
  if (value === "newoutlookforwindows" || value === "windowsnewoutlook")
    return "newOutlookForWindows";
  if (["pst", "ost", "macosprofile", "outlook"].includes(value))
    return "classic";
  return null;
}

const STORE_NAMES: Record<OutlookStoreVariant, string> = {
  newOutlookForMac: "new Outlook for Mac",
  newOutlookForWindows: "new Outlook for Windows",
  classic: "classic Outlook",
};

/** The Outlook a model should name, e.g. "new Outlook for Mac". */
export function storeName(kindOrSource: string | undefined): string | null {
  const variant = outlookStoreVariant(kindOrSource);
  return variant ? STORE_NAMES[variant] : null;
}

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
    "Only part of this item, such as a preview, is cached on this device, so it cannot be retrieved. Do not retry. Use the search hit's metadata and tell the user that the full content is not available on this device.",
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
  const store = storeName(source.sourceKind);
  const name = source.displayName?.trim();
  const product = source.product ?? (store ? "outlook" : source.sourceKind);
  const productLabel =
    store ?? (product === "teams" ? "Teams" : source.sourceKind);
  return {
    sourceId: source.sourceId,
    mailboxId,
    product,
    store,
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

/** False only when every matching source reports the capability as missing. */
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
      cache?.instanceId === instanceId &&
      now - cache.at < SOURCE_DIRECTORY_TTL_MS
    ) {
      return cache.directory;
    }
    const directory = client
      .invoke("sources.list.v1", {}, { signal })
      .then(({ sources }) => sourceDirectory(sources))
      .catch(() => {
        cache = null;
        return null;
      });
    cache = { instanceId, at: now, directory };
    return directory;
  };
}
