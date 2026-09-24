/* eslint-disable lingui/no-unlocalized-strings -- Outlook identifiers and protocol constants. */
import type {
  OutlookFileProvenance,
  OutlookMessageReference,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { SidecarSnapshot } from "@erato/desktop-sidecar-protocol";

const LAUNCH_PREFIX = "erato-launch://outlook/open?reference=";
const MAX_REFERENCE_BYTES = 16_384;

export function uniqueOutlookId(
  reference: OutlookMessageReference,
  key: string,
): string | undefined {
  const values = [
    ...new Set(
      reference.external_ids
        .filter((id) => id.key === key)
        .map((id) => id.value),
    ),
  ];
  return values.length === 1 &&
    values[0].trim() &&
    values[0].length <= 8192 &&
    !/[\r\n\0]/.test(values[0])
    ? values[0]
    : undefined;
}

/** Prefer the containing mailbox message for attachments, including nested mail. */
export function outlookSourceReferences(
  provenance?: OutlookFileProvenance,
): OutlookMessageReference[] {
  if (provenance?.version !== 1) return [];
  const seen = new Set<string>();
  return provenance.origins.flatMap((origin) => {
    const reference = origin.topLevelParent ?? origin.document;
    if (!reference) return [];
    const key = JSON.stringify([
      reference.documentId ?? null,
      reference.mailbox?.mailboxId ?? null,
      reference.mailbox?.emailAddress?.toLowerCase() ?? null,
      reference.mailbox?.profileName ?? null,
      reference.external_ids.map(({ key, value }) => [key, value]).sort(),
    ]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [reference];
  });
}

/** Build only the registered, known URI; discovery must never supply a URL to execute. */
export function outlookSidecarUri(
  reference: OutlookMessageReference,
  snapshot: SidecarSnapshot,
  clientOs?: string,
): string | null {
  if (clientOs !== "windows" || snapshot.state !== "ready") return null;
  const extension =
    snapshot.discoveryExtensions?.["x-erato-outlook-navigation"];
  if (!extension || typeof extension !== "object") return null;
  const descriptor = extension as Record<string, unknown>;
  if (
    descriptor.version !== 1 ||
    descriptor.target !== "classicOutlook" ||
    descriptor.launchUriPrefix !== LAUNCH_PREFIX ||
    typeof descriptor.maxReferenceBytes !== "number" ||
    !Number.isInteger(descriptor.maxReferenceBytes) ||
    descriptor.maxReferenceBytes <= 0
  )
    return null;

  const nativeKeys = ["outlook_entry_id", "outlook_store_id"];
  if (
    reference.external_ids.some(
      (id) => !id.key || !id.value.trim() || /[\r\n\0]/.test(id.value),
    )
  )
    return null;
  for (const key of [...nativeKeys, "email_message_id", "ews_id"]) {
    if (reference.external_ids.some((id) => id.key === key)) {
      const value = uniqueOutlookId(reference, key);
      if (
        !value ||
        (nativeKeys.includes(key) && !/^(?:[a-fA-F0-9]{2})+$/.test(value))
      )
        return null;
    }
  }
  if (
    !uniqueOutlookId(reference, "outlook_entry_id") &&
    !uniqueOutlookId(reference, "email_message_id")
  )
    return null;
  const mailbox = reference.mailbox;
  if (
    mailbox?.mailboxId &&
    !/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(
      mailbox.mailboxId,
    )
  )
    return null;
  if (
    [mailbox?.emailAddress, mailbox?.profileName].some(
      (value) =>
        value !== undefined &&
        (!value.trim() || [...value].length > 1024 || /[\r\n\0]/.test(value)),
    )
  )
    return null;
  if (mailbox && !mailbox.mailboxId && !mailbox.emailAddress) return null;
  if (
    !uniqueOutlookId(reference, "outlook_store_id") &&
    !mailbox?.mailboxId &&
    !mailbox?.emailAddress
  )
    return null;

  const bytes = new TextEncoder().encode(JSON.stringify(reference));
  if (
    bytes.length > Math.min(MAX_REFERENCE_BYTES, descriptor.maxReferenceBytes)
  )
    return null;
  return (
    LAUNCH_PREFIX +
    globalThis
      .btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "")
  );
}
