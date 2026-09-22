import type {
  IndexingStatusV1Result,
  OutlookMailbox,
  SidecarConfiguration,
  SidecarConfigureV1Params,
} from "@erato/desktop-sidecar-protocol";

export const DEFAULT_MAILBOX_PRIORITY = Number.MAX_SAFE_INTEGER;
export type MailboxConfiguration = NonNullable<
  SidecarConfiguration["indexing_mailboxes"]
>[number];

export function indexingMailboxId(mailboxId: string): string {
  // Discovery uses compact IDs; indexing configuration and statistics use UUIDs.
  return mailboxId
    .toLowerCase()
    .replace(
      /^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/,
      "$1-$2-$3-$4-$5",
    );
}

export function effectiveMailboxes(
  configuration: SidecarConfigureV1Params,
): MailboxConfiguration[] {
  return (
    configuration.user_configuration.indexing_mailboxes ??
    configuration.organization_configuration.indexing_mailboxes ??
    []
  );
}

export function initializeMailboxConfiguration(
  configuration: SidecarConfigureV1Params,
  mailboxes: OutlookMailbox[],
  email: string | undefined,
): SidecarConfigureV1Params {
  if (
    configuration.user_configuration.indexing_mailboxes != null ||
    configuration.organization_configuration.indexing_mailboxes != null ||
    !email?.trim()
  )
    return configuration;
  const matching = mailboxes
    .filter(
      (mailbox) =>
        mailbox.emailAddress?.trim().toLowerCase() ===
        email.trim().toLowerCase(),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!matching.length) return configuration;
  return {
    ...configuration,
    user_configuration: {
      ...configuration.user_configuration,
      indexing_mailboxes: matching.map((mailbox) => ({
        mailbox_id: indexingMailboxId(mailbox.id),
        enabled: true,
        priority: 0,
      })),
    },
  };
}

export function orderedMailboxes(
  mailboxes: OutlookMailbox[],
  configuration: SidecarConfigureV1Params,
): (OutlookMailbox & { enabled: boolean; priority: number })[] {
  const overrides = new Map(
    effectiveMailboxes(configuration).map((entry) => [
      indexingMailboxId(entry.mailbox_id),
      entry,
    ]),
  );
  return mailboxes
    .map((mailbox) => {
      const override = overrides.get(indexingMailboxId(mailbox.id));
      return {
        ...mailbox,
        enabled: override?.enabled ?? true,
        priority: override?.priority ?? DEFAULT_MAILBOX_PRIORITY,
      };
    })
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        a.id.toLowerCase().localeCompare(b.id.toLowerCase()),
    );
}

export function mailboxCoverage(
  status: IndexingStatusV1Result,
  mailboxId: string,
  kind: "email" | "file",
) {
  const id = indexingMailboxId(mailboxId);
  // Only active-generation mailbox aggregates: never sum generations or file-type breakdowns.
  const rows =
    status.generations
      .find((generation) => generation.role === "active")
      ?.segments.filter(
        (segment) =>
          segment.mailboxId !== null &&
          indexingMailboxId(segment.mailboxId) === id &&
          segment.kind === kind &&
          segment.fileType === null,
      ) ?? [];
  const sum = (key: "indexedCurrent" | "knownEligible"): number | null =>
    rows.length && rows.every((row) => row.coverage[key] !== null)
      ? rows.reduce((count, row) => count + (row.coverage[key] ?? 0), 0)
      : null;
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Protocol coverage field names.
  return { indexed: sum("indexedCurrent"), total: sum("knownEligible") };
}
