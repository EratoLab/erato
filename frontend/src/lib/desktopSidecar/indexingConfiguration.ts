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

export type MailboxIndexingState =
  | "disabled"
  | "scanFailed"
  | "sourceUnavailable"
  | "indexingUnavailable"
  | "stopped"
  | "scanning"
  | "indexing"
  | "notScanned"
  | "waiting"
  | "current"
  | "unavailable";

/** Bounds are epoch milliseconds; a null `through` ends at `observedAt`. */
export type IndexingRange =
  | {
      kind: "indexed";
      from: number;
      /** An exclusive `from` leaves documents dated exactly at it unprocessed. */
      fromInclusive: boolean;
      through: number | null;
      olderPending: boolean;
    }
  | { kind: "notScanned" }
  | { kind: "nothingSearchable" };

export interface IndexingSummary {
  state: MailboxIndexingState;
  range: IndexingRange | null;
  observedAt: number | null;
  notices: {
    unreadable: boolean;
    notStoredLocally: boolean;
    /** Only what the application cached reached the index, e.g. Teams. */
    cachedOnly: boolean;
  };
}

export type IndexedRange = NonNullable<
  IndexingStatusV1Result["discovery"][number]["indexedRange"]
>;

// SPEC.md treats earlier document dates as undated.
const EARLIEST_DOCUMENT_DATE = Date.UTC(1980, 0, 1);

function timestamp(value: string | null | undefined): number | null {
  const parsed = value == null ? Number.NaN : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function reportedRange(
  ranges: IndexedRange[],
  notScanned: IndexingRange | null,
): Pick<IndexingSummary, "range" | "observedAt"> {
  const observed = ranges.map((range) => timestamp(range.observedAt));
  const observedAt = observed.every((at): at is number => at !== null)
    ? Math.min(...observed)
    : null;
  /* eslint-disable lingui/no-unlocalized-strings -- Protocol unavailable reasons and internal range kinds. */
  if (ranges.some((range) => range.unavailableReason === "not_enumerated"))
    return { range: notScanned, observedAt };
  const nothingSearchable = (range: IndexedRange) =>
    range.unavailableReason === "no_searchable_documents" ||
    range.unavailableReason === "index_not_initialized";
  // A source with nothing left to index cannot narrow what its siblings cover.
  const claimed = ranges.filter(
    (range) => !(nothingSearchable(range) && range.olderPending === 0),
  );
  if (claimed.every(nothingSearchable))
    return { range: { kind: "nothingSearchable" }, observedAt };
  /* eslint-enable lingui/no-unlocalized-strings */
  const starts = claimed.map((range) => timestamp(range.from?.at));
  const ends = claimed.map((range) =>
    timestamp(range.through === null ? range.observedAt : range.through.at),
  );
  if (
    !starts.every((at): at is number => at !== null) ||
    !ends.every((at): at is number => at !== null)
  )
    return { range: null, observedAt };
  const from = Math.max(...starts);
  const through = claimed.some((range) => range.through !== null)
    ? Math.min(...ends)
    : null;
  const end = through ?? observedAt;
  // Sources whose ranges do not overlap share no covered period.
  if (end === null || from > end) return { range: null, observedAt };
  return {
    range: {
      kind: "indexed",
      from,
      fromInclusive: claimed.every(
        (range, index) => starts[index] !== from || range.from?.inclusive,
      ),
      through,
      olderPending: claimed.some((range) => (range.olderPending ?? 0) > 0),
    },
    observedAt,
  };
}

// Earlier depth boundaries hold processing times rather than document dates,
// so only the oldest indexed date of a fully settled source is trusted.
function legacyRange(
  rows: Segment[],
  lastScan: number | null,
): IndexingRange | null {
  const dates = rows
    .map((row) => timestamp(row.depth.oldestIndexedDocumentAt))
    .filter((at): at is number => at !== null && at >= EARLIEST_DOCUMENT_DATE);
  return lastScan !== null && dates.length
    ? {
        kind: "indexed",
        from: Math.min(...dates),
        fromInclusive: true,
        through: null,
        olderPending: false,
      }
    : null;
}

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
): IndexingSummary {
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
  const accounted =
    total !== null &&
    sum([indexed, empty, unindexable, missingFromLocalCache]) === total;
  const settled =
    complete &&
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
  else if (discovery.some((source) => source.state === "notStarted"))
    state = "notScanned";
  else if (
    rows.some(
      (row) =>
        (row.backlog.remaining ?? 0) > 0 ||
        (row.backlog.ready ?? 0) > 0 ||
        (row.backlog.retryDeferred ?? 0) > 0 ||
        (row.coverage.stale ?? 0) > 0 ||
        (row.coverage.neverProcessed ?? 0) > 0 ||
        (row.coverage.pendingDeletions ?? 0) > 0,
    )
  )
    state = "waiting";
  else if (settled) state = "current";
  else state = "unavailable";
  /* eslint-enable lingui/no-unlocalized-strings */
  // If multiple discovery entries contribute, report the oldest successful scan.
  const scans = discovery.map((source) =>
    timestamp(source.lastSuccessfulScanAt),
  );
  const lastScan =
    scans.length && scans.every((at): at is number => at !== null)
      ? Math.min(...scans)
      : null;
  const ranges = discovery.map((source) => source.indexedRange);
  const reported =
    ranges.length > 0 &&
    ranges.every((range): range is IndexedRange => range !== undefined);
  // The status pill already says when a source is being or was never scanned.
  const notScanned: IndexingRange | null =
    state === "notScanned" ||
    discovery.some((source) => source.state === "scanning")
      ? null
      : // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal range kind.
        { kind: "notScanned" };
  const { range, observedAt } = reported
    ? reportedRange(ranges, notScanned)
    : {
        range:
          lastScan === null && discovery.length
            ? notScanned
            : settled
              ? legacyRange(rows, lastScan)
              : null,
        observedAt: lastScan,
      };
  if (state === "disabled")
    return {
      state,
      range: null,
      observedAt,
      notices: {
        unreadable: false,
        notStoredLocally: false,
        cachedOnly: false,
      },
    };
  return {
    state,
    range,
    observedAt,
    notices: {
      unreadable: (unindexable ?? 0) > 0,
      notStoredLocally: (missingFromLocalCache ?? 0) > 0,
      cachedOnly:
        reported &&
        // Unknown inventory values count as cached observations.
        ranges.some((range) => range.inventory !== "localStore"),
    },
  };
}
