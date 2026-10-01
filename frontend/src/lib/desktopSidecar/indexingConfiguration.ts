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
    configuration.user_configuration.indexing_sources != null ||
    configuration.organization_configuration.indexing_sources != null ||
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

type Generation = IndexingStatusV1Result["generations"][number];
type Segment = Generation["segments"][number];
type CoverageCounter =
  | "indexedCurrent"
  | "knownEligible"
  | "emptyCurrent"
  | "unindexableCurrent"
  | "missingFromLocalCacheCurrent";

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function sum(values: (number | null)[]): number | null {
  return values.every((value) => value !== null)
    ? count(values.reduce<number>((total, value) => total + value, 0))
    : null;
}

type StatisticsScope = { mailboxId: string } | { sourceId: string };

function indexingStatistics(
  status: IndexingStatusV1Result,
  scope: StatisticsScope,
  kinds: readonly Segment["kind"][],
) {
  const matches = (row: {
    sourceId: string | null;
    mailboxId: string | null;
  }) => {
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Protocol identity keys.
    const key = "sourceId" in scope ? "sourceId" : "mailboxId";
    const id = "sourceId" in scope ? scope.sourceId : scope.mailboxId;
    return (
      row[key] !== null && indexingMailboxId(row[key]) === indexingMailboxId(id)
    );
  };
  const active = status.generations.find(
    (generation) => generation.role === "active",
  );
  const discovery = status.discovery.filter(matches);
  const complete =
    discovery.length > 0 &&
    discovery.every(
      (source) => source.state === "complete" && source.discoveryComplete,
    );
  const candidates =
    active?.segments.filter(
      (row) =>
        matches(row) && row.fileType === null && kinds.includes(row.kind),
    ) ?? [];
  // A mailbox aggregate and its individual source rows are alternative views.
  const rows = candidates.filter(
    (row) =>
      row.sourceId === null ||
      !candidates.some(
        (other) => other.kind === row.kind && other.sourceId === null,
      ),
  );
  const scopesAvailable = discovery.every(
    (source) =>
      (source.state === "complete" &&
        source.discoveryComplete &&
        source.discoveredDocuments === 0) ||
      rows.some(
        (row) =>
          row.sourceId === null ||
          indexingMailboxId(row.sourceId) ===
            indexingMailboxId(source.sourceId),
      ),
  );
  const available =
    active !== undefined &&
    active.unavailableReason == null &&
    scopesAvailable &&
    kinds.length > 0;
  const empty =
    complete && discovery.every((source) => source.discoveredDocuments === 0);
  // This view requests source breakdowns. Sparse responses omit zero-document
  // kinds, but a missing generation/scope or explicitly unavailable metric is
  // never evidence of zero. The global row confirms that the kind is measured.
  const canInferZero = (kind: Segment["kind"]) =>
    available &&
    (rows.length > 0 || empty) &&
    active.segments.some(
      (row) =>
        row.kind === kind &&
        row.sourceId === null &&
        row.mailboxId === null &&
        row.fileType === null &&
        row.coverage.unavailableReason == null &&
        count(row.coverage.knownEligible) !== null &&
        count(row.coverage.indexedCurrent) !== null,
    );
  return { rows, discovery, complete, available, canInferZero, kinds };
}

function coverageCounter(
  rows: Segment[],
  key: CoverageCounter,
  inferZero: boolean,
): number | null {
  if (!rows.length) return inferZero ? 0 : null;
  return sum(
    rows.map((row) => {
      if (row.coverage.unavailableReason != null) return null;
      const value = row.coverage[key];
      // The additive missing-cache counter is omitted by older v1 sidecars.
      // Explicit null still means unknown; only absence defaults to zero.
      return key === "missingFromLocalCacheCurrent" && value === undefined
        ? 0
        : count(value);
    }),
  );
}

export function mailboxCoverage(
  status: IndexingStatusV1Result,
  mailboxId: string,
  kind: "email" | "file",
) {
  const statistics = indexingStatistics(status, { mailboxId }, [
    "email",
    "file",
  ]);
  const rows = statistics.rows.filter((row) => row.kind === kind);
  const counter = (key: CoverageCounter) =>
    statistics.available
      ? coverageCounter(rows, key, statistics.canInferZero(kind))
      : null;
  /* eslint-disable lingui/no-unlocalized-strings -- Protocol coverage field names. */
  return {
    indexed: counter("indexedCurrent"),
    total: counter("knownEligible"),
  };
  /* eslint-enable lingui/no-unlocalized-strings */
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
  return indexingSummary(
    status,
    indexingStatistics(status, { mailboxId }, ["email", "file"]),
    enabled,
  );
}

export function sourceIndexingSummary(
  status: IndexingStatusV1Result,
  sourceId: string,
  product: string,
  enabled: boolean,
) {
  const kinds: Segment["kind"][] =
    product === "teams"
      ? // eslint-disable-next-line lingui/no-unlocalized-strings -- Protocol document kind.
        ["teams_message"]
      : product === "outlook"
        ? ["email", "file"]
        : [];
  return indexingSummary(
    status,
    indexingStatistics(status, { sourceId }, kinds),
    enabled,
  );
}

function indexingSummary(
  status: IndexingStatusV1Result,
  statistics: ReturnType<typeof indexingStatistics>,
  enabled: boolean,
) {
  const { rows, discovery, complete } = statistics;
  const counter = (key: CoverageCounter) =>
    statistics.available
      ? sum(
          statistics.kinds.map((kind) =>
            coverageCounter(
              rows.filter((row) => row.kind === kind),
              key,
              statistics.canInferZero(kind),
            ),
          ),
        )
      : null;
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Protocol coverage field names.
  const total = counter("knownEligible");
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Protocol coverage field names.
  const indexed = counter("indexedCurrent");
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Protocol coverage field names.
  const missingFromLocalCache = counter("missingFromLocalCacheCurrent");
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Protocol coverage field names.
  const empty = counter("emptyCurrent");
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Protocol coverage field names.
  const unindexable = counter("unindexableCurrent");
  const percentage =
    total === null || indexed === null || total === 0 || indexed > total
      ? null
      : Math.min(
          indexed < total ? 99 : 100,
          Math.floor((indexed / total) * 100),
        );
  const hasEmpty = empty !== null && empty > 0;
  const hasUnindexable = unindexable !== null && unindexable > 0;
  const terminal = hasEmpty || hasUnindexable;
  const accounted =
    total !== null &&
    sum([indexed, empty, unindexable, missingFromLocalCache]) === total;
  const settled =
    statistics.available &&
    accounted &&
    rows.every(
      (row) =>
        row.backlog.unavailableReason == null &&
        row.backlog.discoveryComplete &&
        row.backlog.remaining === 0 &&
        row.backlog.inProgress === 0 &&
        row.backlog.blocked === 0 &&
        row.coverage.stale === 0 &&
        row.coverage.neverProcessed === 0 &&
        row.coverage.pendingDeletions === 0,
    );
  /* eslint-disable lingui/no-unlocalized-strings -- Internal state keys; translated by the indexing card. */
  let state: MailboxIndexingState;
  if (!enabled || discovery.some((source) => source.state === "disabled"))
    state = "disabled";
  else if (status.state === "blocked") state = "indexingUnavailable";
  else if (
    status.state === "stopped" ||
    status.state === "stopping" ||
    status.resetInProgress === true
  )
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
  else if (
    rows.some(
      (row) =>
        (row.backlog.remaining ?? 0) > 0 ||
        (row.backlog.ready ?? 0) > 0 ||
        (row.backlog.retryDeferred ?? 0) > 0 ||
        (row.coverage.stale ?? 0) > 0 ||
        (row.coverage.neverProcessed ?? 0) > 0 ||
        (row.coverage.pendingDeletions ?? 0) > 0,
    ) ||
    discovery.some((source) => source.state === "notStarted")
  )
    state = "waiting";
  else if (complete && settled)
    state =
      hasUnindexable || (missingFromLocalCache ?? 0) > 0
        ? "partial"
        : hasEmpty
          ? "complete"
          : "current";
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
    missingFromLocalCache,
    terminal: terminal && complete && settled,
    hasUnindexable,
    lastScan,
  };
}
