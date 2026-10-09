import {
  DEFAULT_MAILBOX_PRIORITY,
  effectiveMailboxes,
  indexingMailboxId,
  orderedMailboxes,
} from "./indexingConfiguration";
import { outlookStoreVariant } from "./sourceCapabilities";

import type { OutlookStoreVariant } from "./sourceCapabilities";
import type {
  OutlookMailbox,
  SidecarConfiguration,
  SidecarConfigureV1Params,
  SourcesListV1Result,
} from "@erato/desktop-sidecar-protocol";

type Source = SourcesListV1Result["sources"][number];

/** The signed-in Teams identity behind a Teams source. */
export interface IndexingAccount {
  /** Login address; a guest identity carries its home address. */
  email: string | null;
  guest: boolean;
}

export interface IndexingEntry {
  id: string;
  scope: "source" | "mailbox";
  product: string;
  /** Which Outlook, when the sidecar says. */
  variant?: OutlookStoreVariant;
  name: string | null;
  account?: IndexingAccount;
  /** The sidecar matched this source to the signed-in work account. */
  workAccount?: boolean;
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

function firstName(...names: (string | null | undefined)[]): string | null {
  return names.map((name) => name?.trim()).find((name) => !!name) ?? null;
}

function teamsAccount(source: Source): IndexingAccount | undefined {
  const account = source.account;
  if (!account) return undefined;
  const principal = account.userPrincipalName?.trim();
  return {
    email:
      firstName(
        account.email,
        // Guest UPNs (`name_home.example#EXT#@tenant…`) are not addresses.
        principal && !principal.toUpperCase().includes("#EXT#")
          ? principal
          : undefined,
      )?.toLowerCase() ?? null,
    guest: account.userType?.trim().toLowerCase() === "guest",
  };
}

const PRODUCT_ORDER = ["outlook", "teams"];

/** Sources are listed per application, Outlook first, then by priority. */
function productRank(product: string): number {
  const rank = PRODUCT_ORDER.indexOf(product);
  return rank === -1 ? PRODUCT_ORDER.length : rank;
}

/** Keeps a home account and its guest tenants together at equal priority. */
function groupKey(entry: IndexingEntry): string {
  return entry.account?.email
    ? `${entry.product}:${entry.account.email}`
    : entry.id;
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
    const account = product === "teams" ? teamsAccount(source) : undefined;
    const variant =
      product === "outlook"
        ? outlookStoreVariant(source.sourceKind)
        : undefined;
    entries.push({
      id,
      scope: "source",
      product,
      ...(variant && { variant }),
      // A Teams source is one organisation the person is signed in to.
      name: firstName(
        account ? source.account?.tenantName : undefined,
        mailbox?.emailAddress,
        source.displayName,
        mailbox?.displayName,
      ),
      ...(account && { account }),
      ...(source.defaultReason === "workAccount" && { workAccount: true }),
      enabled: policy?.enabled ?? source.indexingEnabled ?? source.enabled,
      priority:
        policy?.priority ?? source.indexingPriority ?? DEFAULT_MAILBOX_PRIORITY,
      editable: sourceControls,
    });
  }
  for (const mailbox of orderedMailboxes(mailboxes, configuration)) {
    if (represented.has(indexingMailboxId(mailbox.id))) continue;
    const variant = outlookStoreVariant(mailbox.source);
    entries.push({
      id: indexingMailboxId(mailbox.id),
      scope: "mailbox",
      product: "outlook",
      ...(variant && { variant }),
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
    (a, b) =>
      productRank(a.product) - productRank(b.product) ||
      a.product.localeCompare(b.product) ||
      a.priority - b.priority ||
      groupKey(a).localeCompare(groupKey(b)) ||
      Number(a.account?.guest ?? false) - Number(b.account?.guest ?? false) ||
      (a.name ?? "").localeCompare(b.name ?? "") ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Priorities for a reordered list. Each application is ordered on its own, so
 * the first source of every application runs side by side instead of Teams
 * waiting for every Outlook mailbox.
 */
export function rankedWithinProduct(entries: IndexingEntry[]): IndexingEntry[] {
  const next = new Map<string, number>();
  return entries.map((entry) => {
    const priority = next.get(entry.product) ?? 0;
    next.set(entry.product, priority + 1);
    return { ...entry, priority };
  });
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
