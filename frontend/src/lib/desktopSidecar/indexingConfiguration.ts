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

export type MailboxIndexingState =
  | "disabled"
  | "scanFailed"
  | "sourceUnavailable"
  | "indexingUnavailable"
  | "partial"
  | "complete"
  | "stopped"
  | "scanning"
  | "indexing"
  | "waiting"
  | "current"
  | "unavailable";

export function mailboxIndexingSummary(
  status: IndexingStatusV1Result,
  mailboxId: string,
  enabled: boolean,
) {
  const id = indexingMailboxId(mailboxId);
  const rows =
    status.generations
      .find((generation) => generation.role === "active")
      ?.segments.filter(
        (row) =>
          row.mailboxId !== null &&
          indexingMailboxId(row.mailboxId) === id &&
          row.fileType === null &&
          (row.kind === "email" || row.kind === "file"),
      ) ?? [];
  const discovery = status.discovery.filter(
    (source) =>
      source.mailboxId !== null && indexingMailboxId(source.mailboxId) === id,
  );
  const complete =
    discovery.length > 0 &&
    discovery.every(
      (source) => source.state === "complete" && source.discoveryComplete,
    );
  const email = mailboxCoverage(status, id, "email");
  const file = mailboxCoverage(status, id, "file");
  const total =
    email.total === null || file.total === null
      ? null
      : email.total + file.total;
  const indexed =
    email.indexed === null || file.indexed === null
      ? null
      : email.indexed + file.indexed;
  const percentage =
    total === null || indexed === null || total === 0
      ? null
      : Math.min(
          indexed < total ? 99 : 100,
          Math.floor((indexed / total) * 100),
        );
  const hasEmpty = rows.some((row) => (row.coverage.emptyCurrent ?? 0) > 0);
  const hasUnindexable = rows.some(
    (row) => (row.coverage.unindexableCurrent ?? 0) > 0,
  );
  const terminal = hasEmpty || hasUnindexable;
  const settled =
    rows.length > 0 &&
    rows.every(
      (row) =>
        row.backlog.discoveryComplete &&
        row.backlog.remaining === 0 &&
        row.coverage.stale === 0 &&
        row.coverage.neverProcessed === 0 &&
        row.coverage.pendingDeletions === 0,
    );
  /* eslint-disable lingui/no-unlocalized-strings -- Internal state keys; translated by the indexing card. */
  let state: MailboxIndexingState;
  if (!enabled || discovery.some((source) => source.state === "disabled"))
    state = "disabled";
  else if (status.state === "blocked") state = "indexingUnavailable";
  else if (status.state === "stopped" || status.state === "stopping")
    state = "stopped";
  else if (discovery.some((source) => !source.accessible))
    state = "sourceUnavailable";
  else if (discovery.some((source) => source.state === "failed"))
    state = "scanFailed";
  else if (rows.some((row) => (row.backlog.blocked ?? 0) > 0))
    state = "indexingUnavailable";
  else if (rows.some((row) => (row.backlog.inProgress ?? 0) > 0))
    state = "indexing";
  else if (discovery.some((source) => source.state === "scanning"))
    state = "scanning";
  else if (complete && settled && total !== null && indexed !== null)
    state = hasUnindexable
      ? "partial"
      : hasEmpty
        ? "complete"
        : indexed === total
          ? "current"
          : "unavailable";
  else if (
    rows.some(
      (row) =>
        (row.backlog.remaining ?? 0) > 0 ||
        (row.coverage.stale ?? 0) > 0 ||
        (row.coverage.pendingDeletions ?? 0) > 0,
    ) ||
    discovery.some((source) => source.state === "notStarted")
  )
    state = "waiting";
  else state = "unavailable";
  /* eslint-enable lingui/no-unlocalized-strings */
  // If multiple discovery entries contribute, report the oldest successful scan.
  const scans = discovery.map((source) => source.lastSuccessfulScanAt);
  const lastScan =
    scans.length &&
    scans.every((scan) => scan !== null && Number.isFinite(Date.parse(scan)))
      ? Math.min(...scans.map((scan) => Date.parse(scan ?? "")))
      : null;
  return {
    state,
    total,
    indexed,
    percentage,
    terminal: terminal && complete && settled,
    hasUnindexable,
    lastScan,
  };
}
