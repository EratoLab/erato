import {
  DEFAULT_MAILBOX_PRIORITY,
  effectiveMailboxes,
  indexingMailboxId,
  orderedMailboxes,
} from "./indexingConfiguration";

import type {
  OutlookMailbox,
  SidecarConfiguration,
  SidecarConfigureV1Params,
  SourcesListV1Result,
} from "@erato/desktop-sidecar-protocol";

type Source = SourcesListV1Result["sources"][number];

export interface IndexingEntry {
  id: string;
  scope: "source" | "mailbox";
  product: string;
  name: string | null;
  number?: number;
  enabled: boolean;
  priority: number;
  editable: boolean;
}

function effectiveSources(configuration: SidecarConfigureV1Params) {
  return (
    configuration.user_configuration.indexing_sources ??
    configuration.organization_configuration.indexing_sources ??
    []
  );
}

function sourceProduct(source: Source): string {
  if (source.product) return source.product;
  const kind = source.sourceKind.trim().toLowerCase();
  if (kind === "teams") return "teams";
  if (
    [
      "outlook",
      "pst",
      "ost",
      "macos profile",
      "macos hx account",
      "new outlook for windows",
      "windowsnewoutlook",
    ].includes(kind)
  )
    return "outlook";
  return "unknown";
}

function firstName(...names: (string | undefined)[]): string | null {
  return names.map((name) => name?.trim()).find((name) => !!name) ?? null;
}

export function indexingEntries(
  mailboxes: OutlookMailbox[],
  sources: Source[] | undefined,
  configuration: SidecarConfigureV1Params,
): IndexingEntry[] {
  // sources.list predates source configuration. Do not offer controls that an
  // older sidecar would merely preserve without applying them.
  const sourceControls =
    configuration.user_configuration.indexing_sources !== undefined ||
    configuration.organization_configuration.indexing_sources !== undefined;
  const policies = new Map(
    effectiveSources(configuration).map((policy) => [
      indexingMailboxId(policy.source_id),
      policy,
    ]),
  );
  const represented = new Set<string>();
  const entries: IndexingEntry[] = [];
  for (const source of sources ?? []) {
    const id = indexingMailboxId(source.sourceId);
    const product = sourceProduct(source);
    const mailbox = mailboxes.find(
      (mailbox) =>
        (Array.isArray(mailbox.sourceIds) &&
          mailbox.sourceIds.some(
            (sourceId) =>
              typeof sourceId === "string" &&
              indexingMailboxId(sourceId) === id,
          )) ||
        (typeof source.locator.mailboxId === "string" &&
          indexingMailboxId(source.locator.mailboxId) ===
            indexingMailboxId(mailbox.id)),
    );
    // Legacy Outlook controls apply to the mailbox as a whole. Other sources
    // still have visible statistics, with controls disabled until upgraded.
    if (!sourceControls && mailbox) continue;
    if (mailbox) represented.add(indexingMailboxId(mailbox.id));
    const policy = policies.get(id);
    entries.push({
      id,
      scope: "source",
      product,
      name: firstName(
        mailbox?.emailAddress,
        source.displayName,
        mailbox?.displayName,
      ),
      enabled: policy?.enabled ?? source.indexingEnabled ?? source.enabled,
      priority: policy?.priority ?? DEFAULT_MAILBOX_PRIORITY,
      editable: sourceControls,
    });
  }
  for (const mailbox of orderedMailboxes(mailboxes, configuration)) {
    if (represented.has(indexingMailboxId(mailbox.id))) continue;
    entries.push({
      id: indexingMailboxId(mailbox.id),
      scope: "mailbox",
      product: "outlook",
      name: firstName(mailbox.emailAddress, mailbox.displayName),
      enabled: mailbox.enabled,
      priority: mailbox.priority,
      editable: true,
    });
  }
  // Duplicate names are presentation only: never merge separate logins/caches.
  // Number by stable identity, independent of response order and priority edits.
  const byId = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  for (const entry of entries) {
    const peers = byId.filter(
      (other) => other.name === entry.name && other.product === entry.product,
    );
    if (peers.length > 1) entry.number = peers.indexOf(entry) + 1;
  }
  return entries.sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
  );
}

/** Update only visible, edited policies; keep disconnected entries and extensions. */
export function indexingEntryPatch(
  configuration: SidecarConfigureV1Params,
  entries: IndexingEntry[],
): Partial<SidecarConfiguration> {
  const patch: Partial<SidecarConfiguration> = {};
  for (const entry of entries) {
    if (!entry.editable) continue;
    if (entry.scope === "source") {
      const previous =
        patch.indexing_sources ?? effectiveSources(configuration);
      patch.indexing_sources = [
        ...previous.filter(
          (policy) => indexingMailboxId(policy.source_id) !== entry.id,
        ),
        {
          ...previous.find(
            (policy) => indexingMailboxId(policy.source_id) === entry.id,
          ),
          source_id: entry.id,
          enabled: entry.enabled,
          priority: entry.priority,
        },
      ];
    } else {
      const previous =
        patch.indexing_mailboxes ?? effectiveMailboxes(configuration);
      patch.indexing_mailboxes = [
        ...previous.filter(
          (policy) => indexingMailboxId(policy.mailbox_id) !== entry.id,
        ),
        {
          ...previous.find(
            (policy) => indexingMailboxId(policy.mailbox_id) === entry.id,
          ),
          mailbox_id: entry.id,
          enabled: entry.enabled,
          priority: entry.priority,
        },
      ];
    }
  }
  return patch;
}
