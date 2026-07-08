import {
  computeCalendarRanges,
  decodeMergedFreeBusyView,
  onlyBlockingBlocks,
  resolveTimezone,
  runCalendarLegs,
} from "./calendarLegs";
import { utcInstantToCivilDate } from "./calendarTime";
import {
  allMessagesEls,
  allTypesEls,
  assertResponseOk,
  buildAdditionalPropertiesXml,
  buildSoapEnvelope,
  escapeXml,
  ewsHostFetch,
  firstMessagesEl,
  firstTypesEl,
  getEwsUrl,
  throwIfAborted,
  typesText,
} from "./fetchOutlookMessageEws";
import { toIanaStrict } from "./windowsZones";

import type { CalendarRange } from "./calendarLegs";
import type {
  CalendarFetchOptions,
  NormalizedAttendeeAvailability,
  NormalizedBusyBlock,
  NormalizedBusyType,
  NormalizedCalendar,
  NormalizedEventWhen,
  NormalizedHistoryMeeting,
  NormalizedWorkingHours,
} from "./fetchOutlookCalendar";

export type { CalendarRange } from "./calendarLegs";

/**
 * EWS SOAP calendar sourcing for Exchange on-prem / Subscription Edition
 * (SI-3 / ERMAIN-385), where Graph does not exist; Graph sibling in
 * `./fetchOutlookCalendarGraph.ts`, shared contract in `./fetchOutlookCalendar.ts`.
 * v1 reads the SIGNED-IN USER's OWN calendar, proven live against SE 15.2.2562
 * at RequestServerVersion Exchange2013_SP1. Every operation uses the HOST
 * transport ({@link ewsHostFetch} → `makeEwsRequestAsync`) — calendar /
 * availability reads are mailbox-wide, which the item-scoped callback token
 * does not authorize. CalendarView expands recurring series into occurrences;
 * all-day events arrive as the UTC instant of authoring-zone midnight and are
 * localized back to that zone (never `.slice`d off the raw `Z` string — the
 * classic off-by-one all-day bug). Per-leg fetchers THROW on hard failure; the
 * top-level fetcher degrades each leg independently.
 */

interface RawCalendarItem {
  start: string;
  end: string;
  subject: string;
  isRecurring: boolean;
  legacyFreeBusyStatus: string | undefined;
  isAllDay: boolean;
  /** StartTimeZone `Id` (a Windows zone name), when present. */
  startTimeZoneId: string | undefined;
}

// --- SOAP body builders ----------------------------------------------------

/** Deliberately does NOT reuse the mail `buildParentFolderIdsXml`, which fans
 * out over the well-known MAIL folders. */
export function buildCalendarViewFindItemBody(
  startUtc: string,
  endUtc: string,
): string {
  return (
    '<m:FindItem Traversal="Shallow">' +
    "<m:ItemShape>" +
    "<t:BaseShape>IdOnly</t:BaseShape>" +
    buildAdditionalPropertiesXml([
      "item:Subject",
      "calendar:Start",
      "calendar:End",
      "calendar:IsRecurring",
      "calendar:LegacyFreeBusyStatus",
      "calendar:IsAllDayEvent",
      "calendar:StartTimeZone",
    ]) +
    "</m:ItemShape>" +
    `<m:CalendarView MaxEntriesReturned="1000" StartDate="${startUtc}" EndDate="${endUtc}"/>` +
    "<m:ParentFolderIds>" +
    '<t:DistinguishedFolderId Id="calendar"/>' +
    "</m:ParentFolderIds>" +
    "</m:FindItem>"
  );
}

/**
 * A no-DST, UTC `SerializableTimeZone` for GetUserAvailability. `Month=0` /
 * `DayOrder=0` signals "no transition" and is confirmed accepted on live SE;
 * a StandardTime/DaylightTime pair sharing the same Jan-1 transition is
 * REJECTED as "The specified time zone isn't valid" — don't "simplify" to that.
 */
function buildSerializableUtcTimeZone(): string {
  const noTransition =
    "<t:Bias>0</t:Bias>" +
    "<t:Time>00:00:00</t:Time>" +
    "<t:DayOrder>0</t:DayOrder>" +
    "<t:Month>0</t:Month>" +
    "<t:DayOfWeek>Sunday</t:DayOfWeek>";
  return (
    "<t:TimeZone>" +
    "<t:Bias>0</t:Bias>" +
    `<t:StandardTime>${noTransition}</t:StandardTime>` +
    `<t:DaylightTime>${noTransition}</t:DaylightTime>` +
    "</t:TimeZone>"
  );
}

/** Merged free/busy slice width for GetUserAvailability (and the decode
 * anchor when a response is MergedOnly). */
export const EWS_MERGED_FREE_BUSY_INTERVAL_MINUTES = 30;

/** Element order is STRICT per the schema (TimeZone → MailboxDataArray →
 * FreeBusyViewOptions; TimeWindow → Interval → RequestedView). RequestedView
 * `Detailed` makes the response carry WorkingHours (the self working-hours
 * leg); the attendee leg asks `FreeBusy` — opaque intervals, no details.
 * FreeBusyResponses come back in MailboxDataArray order. */
export function buildGetUserAvailabilityBody(
  smtpAddresses: string[],
  startUtc: string,
  endUtc: string,
  requestedView: "Detailed" | "FreeBusy",
): string {
  const mailboxData = smtpAddresses
    .map(
      (smtpAddress) =>
        "<t:MailboxData>" +
        "<t:Email>" +
        `<t:Address>${escapeXml(smtpAddress)}</t:Address>` +
        "</t:Email>" +
        "<t:AttendeeType>Required</t:AttendeeType>" +
        "<t:ExcludeConflicts>false</t:ExcludeConflicts>" +
        "</t:MailboxData>",
    )
    .join("");
  return (
    "<m:GetUserAvailabilityRequest>" +
    buildSerializableUtcTimeZone() +
    `<m:MailboxDataArray>${mailboxData}</m:MailboxDataArray>` +
    "<t:FreeBusyViewOptions>" +
    "<t:TimeWindow>" +
    `<t:StartTime>${startUtc}</t:StartTime>` +
    `<t:EndTime>${endUtc}</t:EndTime>` +
    "</t:TimeWindow>" +
    `<t:MergedFreeBusyIntervalInMinutes>${EWS_MERGED_FREE_BUSY_INTERVAL_MINUTES}</t:MergedFreeBusyIntervalInMinutes>` +
    `<t:RequestedView>${requestedView}</t:RequestedView>` +
    "</t:FreeBusyViewOptions>" +
    "</m:GetUserAvailabilityRequest>"
  );
}

/**
 * ResolveNames against the directory (SI-3 plumbing style, ERMAIN-434): turns
 * a GAL display name into mailbox candidates. `ContactsActiveDirectory` is not
 * used — personal contacts can shadow a colleague's directory entry.
 */
export function buildResolveNamesBody(unresolvedEntry: string): string {
  return (
    '<m:ResolveNames ReturnFullContactData="false" SearchScope="ActiveDirectory">' +
    `<m:UnresolvedEntry>${escapeXml(unresolvedEntry)}</m:UnresolvedEntry>` +
    "</m:ResolveNames>"
  );
}

/** ExpandDL: one level only — nested DLs are reported, never recursed. */
export function buildExpandDlBody(smtpAddress: string): string {
  return (
    "<m:ExpandDL>" +
    "<m:Mailbox>" +
    `<t:EmailAddress>${escapeXml(smtpAddress)}</t:EmailAddress>` +
    "</m:Mailbox>" +
    "</m:ExpandDL>"
  );
}

// --- Response parsing ------------------------------------------------------

export function parseCalendarView(doc: Document): RawCalendarItem[] {
  const items: RawCalendarItem[] = [];
  for (const responseMessage of allMessagesEls(
    doc,
    "FindItemResponseMessage",
  )) {
    assertResponseOk(responseMessage);
    const rootFolder = firstMessagesEl(responseMessage, "RootFolder");
    if (rootFolder?.getAttribute("IncludesLastItemInRange") === "false") {
      console.warn(
        "[parseCalendarView] FindItem results truncated (IncludesLastItemInRange=false); some calendar items were dropped",
      );
    }
    for (const calendarItem of allTypesEls(responseMessage, "CalendarItem")) {
      const start = typesText(calendarItem, "Start");
      const end = typesText(calendarItem, "End");
      // Skip malformed rows rather than emit an interval with missing bounds.
      if (!start || !end) continue;
      items.push({
        start,
        end,
        subject: typesText(calendarItem, "Subject") ?? "",
        isRecurring: typesText(calendarItem, "IsRecurring") === "true",
        legacyFreeBusyStatus: typesText(calendarItem, "LegacyFreeBusyStatus"),
        isAllDay: typesText(calendarItem, "IsAllDayEvent") === "true",
        startTimeZoneId:
          firstTypesEl(calendarItem, "StartTimeZone")?.getAttribute("Id") ??
          undefined,
      });
    }
  }
  return items;
}

/**
 * `NormalizedWorkingHours` carries a SINGLE window (as does Graph), so multiple
 * WorkingPeriods collapse lossily: the window comes from the FIRST period and
 * only days of same-window periods are kept — dropping a day understates
 * availability, which is safe; unioning it under the wrong hours is not.
 */
export function parseAvailability(
  doc: Document,
): NormalizedWorkingHours | null {
  const freeBusyResponse = allMessagesEls(doc, "FreeBusyResponse")[0];
  if (!freeBusyResponse) return null;
  const responseMessage = firstMessagesEl(freeBusyResponse, "ResponseMessage");
  if (responseMessage) {
    assertResponseOk(responseMessage);
  }
  const workingHours = firstTypesEl(freeBusyResponse, "WorkingHours");
  if (!workingHours) return null;
  const periods = allTypesEls(workingHours, "WorkingPeriod");
  if (periods.length === 0) return null;

  const first = periods[0];
  const startMinutes = Number(typesText(first, "StartTimeInMinutes"));
  const endMinutes = Number(typesText(first, "EndTimeInMinutes"));
  if (Number.isNaN(startMinutes) || Number.isNaN(endMinutes)) return null;

  const daysOfWeek = new Set<string>();
  let droppedPeriods = 0;
  for (const period of periods) {
    if (
      Number(typesText(period, "StartTimeInMinutes")) !== startMinutes ||
      Number(typesText(period, "EndTimeInMinutes")) !== endMinutes
    ) {
      droppedPeriods += 1;
      continue;
    }
    // DayOfWeek is a space-separated list; lowercased to match Graph's day names.
    for (const day of (typesText(period, "DayOfWeek") ?? "").split(/\s+/)) {
      if (day) daysOfWeek.add(day.toLowerCase());
    }
  }
  if (droppedPeriods > 0) {
    console.warn(
      `[parseAvailability] dropped ${droppedPeriods} WorkingPeriod(s) with hours differing from the first; workingHours understates availability`,
    );
  }
  return {
    daysOfWeek: Array.from(daysOfWeek),
    startMinutes,
    endMinutes,
  };
}

/** A `t:Mailbox` as ResolveNames / ExpandDL return it. */
export interface EwsMailboxEntry {
  name?: string;
  emailAddress?: string;
  routingType?: string;
  mailboxType?: string;
}

function parseMailboxEl(mailbox: Element): EwsMailboxEntry {
  return {
    name: typesText(mailbox, "Name"),
    emailAddress: typesText(mailbox, "EmailAddress"),
    routingType: typesText(mailbox, "RoutingType"),
    mailboxType: typesText(mailbox, "MailboxType"),
  };
}

/** Zero matches is a RESULT ([]), not an error; ambiguous names come back as
 * ResponseClass "Warning" WITH the candidate set, which passes through. */
export function parseResolveNames(doc: Document): EwsMailboxEntry[] {
  const responseMessage = allMessagesEls(doc, "ResolveNamesResponseMessage")[0];
  if (!responseMessage) return [];
  assertResponseOk(responseMessage, new Set(["ErrorNameResolutionNoResults"]));
  return allTypesEls(responseMessage, "Resolution")
    .map((resolution) => firstTypesEl(resolution, "Mailbox"))
    .filter((mailbox): mailbox is Element => mailbox !== null)
    .map(parseMailboxEl);
}

export function parseExpandDl(doc: Document): {
  members: EwsMailboxEntry[];
  truncated: boolean;
} {
  const responseMessage = allMessagesEls(doc, "ExpandDLResponseMessage")[0];
  if (!responseMessage) return { members: [], truncated: false };
  assertResponseOk(responseMessage);
  const expansion = firstMessagesEl(responseMessage, "DLExpansion");
  if (!expansion) return { members: [], truncated: false };
  return {
    members: allTypesEls(expansion, "Mailbox").map(parseMailboxEl),
    // Same contract as the FindItem check: only an explicit "false" means
    // the server cut the list (ExpandDL is unpaged).
    truncated: expansion.getAttribute("IncludesLastItemInRange") === "false",
  };
}

/** One mailbox's slice of a GetUserAvailability response. */
export type EwsFreeBusyResult =
  | { kind: "ok"; blocks: NormalizedBusyBlock[] }
  | { kind: "error"; reason: string };

/**
 * Per-mailbox FreeBusyResponses, in MailboxDataArray order. A per-mailbox
 * error (ErrorNoFreeBusyAccess & co) is a RESULT — one denied colleague must
 * not sink the others — so this never calls the throwing `assertResponseOk`.
 * Blocks come from CalendarEventArray when present (RequestedView FreeBusy),
 * else from the MergedFreeBusy string (MergedOnly — all the sharing policy
 * publishes); `'4'`/NoData reads as Busy, never free.
 */
export function parseAttendeeFreeBusy(
  doc: Document,
  windowStartUtc: string,
): EwsFreeBusyResult[] {
  return allMessagesEls(doc, "FreeBusyResponse").map((freeBusyResponse) => {
    const responseMessage = firstMessagesEl(
      freeBusyResponse,
      "ResponseMessage",
    );
    if (responseMessage?.getAttribute("ResponseClass") === "Error") {
      const reason =
        firstMessagesEl(responseMessage, "MessageText")?.textContent ??
        firstMessagesEl(responseMessage, "ResponseCode")?.textContent ??
        "free/busy lookup failed";
      return { kind: "error", reason };
    }
    const view = firstMessagesEl(freeBusyResponse, "FreeBusyView");
    if (!view) {
      return { kind: "error", reason: "no free/busy view returned" };
    }
    const events = allTypesEls(view, "CalendarEvent");
    if (events.length > 0 || firstTypesEl(view, "CalendarEventArray")) {
      const blocks: NormalizedBusyBlock[] = [];
      for (const event of events) {
        const start = typesText(event, "StartTime");
        const end = typesText(event, "EndTime");
        if (!start || !end) continue;
        blocks.push({
          when: {
            kind: "date-time",
            startUtc: toUtcIso(start),
            endUtc: toUtcIso(end),
          },
          // BusyType NoData (or anything unknown) → Busy via mapBusyType.
          busyType: mapBusyType(typesText(event, "BusyType")),
        });
      }
      return { kind: "ok", blocks: onlyBlockingBlocks(blocks) };
    }
    const merged = typesText(view, "MergedFreeBusy");
    if (merged !== undefined) {
      return {
        kind: "ok",
        blocks: onlyBlockingBlocks(
          decodeMergedFreeBusyView(
            merged,
            windowStartUtc,
            EWS_MERGED_FREE_BUSY_INTERVAL_MINUTES,
            "Busy",
          ),
        ),
      };
    }
    // Ambiguous fall-through: FreeBusy/Detailed with zero events (SE OMITS the
    // CalendarEventArray, not an empty one) = genuinely free; None (e.g.
    // cross-forest) = no data and must NOT read as free — parity with Graph,
    // which maps its no-data state to unknown. View type is the only tell.
    const viewType = typesText(view, "FreeBusyViewType");
    if (viewType === "None" || !viewType) {
      return { kind: "error", reason: "no free/busy information available" };
    }
    return { kind: "ok", blocks: [] };
  });
}

// --- Normalization helpers -------------------------------------------------

/** EWS dateTime → millis-free UTC `…Z`. Values with an explicit offset (as a
 * TimeZoneContext'd box would emit) are re-serialized as UTC; only a bare value
 * (no designator) is assumed already-UTC. */
function toUtcIso(value: string): string {
  if (/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  return `${value}Z`;
}

/** All-day civil dates are recovered by localizing the UTC instant to the
 * item's authoring zone, falling back to the mailbox `displayTimeZone`.
 * Resolution is strict — the `toIana` fallback would anchor to the VIEWER's OS
 * zone and shift all-day dates by ±1 day. */
function normalizeWhen(
  item: RawCalendarItem,
  displayTimeZone: string,
): { when: NormalizedEventWhen; authoringTimeZone: string | null } {
  const authoringTimeZone = toIanaStrict(item.startTimeZoneId);
  if (item.isAllDay) {
    const anchor = authoringTimeZone ?? displayTimeZone;
    return {
      when: {
        kind: "date",
        startDate: utcInstantToCivilDate(toUtcIso(item.start), anchor),
        endDateExclusive: utcInstantToCivilDate(toUtcIso(item.end), anchor),
      },
      authoringTimeZone,
    };
  }
  return {
    when: {
      kind: "date-time",
      startUtc: toUtcIso(item.start),
      endUtc: toUtcIso(item.end),
    },
    authoringTimeZone,
  };
}

const BUSY_TYPES: ReadonlySet<string> = new Set([
  "Free",
  "Tentative",
  "Busy",
  "OOF",
  "WorkingElsewhere",
] satisfies NormalizedBusyType[]);

function mapBusyType(
  legacyFreeBusyStatus: string | undefined,
): NormalizedBusyType {
  return legacyFreeBusyStatus && BUSY_TYPES.has(legacyFreeBusyStatus)
    ? (legacyFreeBusyStatus as NormalizedBusyType)
    : "Busy";
}

// --- Public per-leg fetchers -----------------------------------------------

/** Past meetings in `range` (the look-back window). */
export async function fetchCalendarHistoryViaEws(
  range: CalendarRange,
  options: CalendarFetchOptions = {},
): Promise<NormalizedHistoryMeeting[]> {
  throwIfAborted(options.signal);
  const displayTimeZone = resolveTimezone();
  const doc = await ewsHostFetch(
    buildSoapEnvelope(
      buildCalendarViewFindItemBody(range.startUtc, range.endUtc),
    ),
  );
  return parseCalendarView(doc).map((item) => {
    const { when, authoringTimeZone } = normalizeWhen(item, displayTimeZone);
    // No attendeeCount: FindItem never returns recipient lists (GetItem-only),
    // so a count derived here would always read 0 — a false "solo meeting" claim.
    return {
      when,
      subject: item.subject,
      isRecurring: item.isRecurring,
      authoringTimeZone,
    };
  });
}

/** Busy blocks in `range`. busyType is faithful (Free included); the prompt
 * decides policy. */
export async function fetchCalendarBusyViaEws(
  range: CalendarRange,
  options: CalendarFetchOptions = {},
): Promise<NormalizedBusyBlock[]> {
  throwIfAborted(options.signal);
  const displayTimeZone = resolveTimezone();
  const doc = await ewsHostFetch(
    buildSoapEnvelope(
      buildCalendarViewFindItemBody(range.startUtc, range.endUtc),
    ),
  );
  return parseCalendarView(doc).map((item) => {
    const { when, authoringTimeZone } = normalizeWhen(item, displayTimeZone);
    return {
      when,
      busyType: mapBusyType(item.legacyFreeBusyStatus),
      subject: item.subject || undefined,
      authoringTimeZone,
    };
  });
}

/** Working hours from GetUserAvailability. Returns null when genuinely absent;
 * THROWS on a hard EWS failure. */
export async function fetchWorkingHoursViaEws(
  range: CalendarRange,
  options: CalendarFetchOptions = {},
): Promise<NormalizedWorkingHours | null> {
  const smtpAddress = Office.context.mailbox.userProfile?.emailAddress;
  if (!smtpAddress) return null;
  throwIfAborted(options.signal);
  const doc = await ewsHostFetch(
    buildSoapEnvelope(
      buildGetUserAvailabilityBody(
        [smtpAddress],
        range.startUtc,
        range.endUtc,
        "Detailed",
      ),
    ),
  );
  return parseAvailability(doc);
}

// --- Attendee availability (ERMAIN-434) --------------------------------------

/** Total resolved-mailbox budget per fetch: inputs are capped upstream at
 * MAX_ATTENDEES, but one DL can expand wide — spend in input order, stop here. */
export const EWS_MAX_RESOLVED_MAILBOXES = 30;

type ResolvedInput =
  | {
      requested: string;
      smtps: { smtp: string; caveat?: string }[];
      /** Members that could NOT be checked (shape-dropped / truncated list) —
       * each becomes an aggregated unknown entry, like the attendee cap. */
      notChecked?: string[];
    }
  | { requested: string; unknownReason: string };

const hasSmtpShape = (entry: EwsMailboxEntry): boolean =>
  Boolean(entry.emailAddress?.includes("@")) &&
  (entry.routingType === undefined || entry.routingType === "SMTP");

const isDl = (entry: EwsMailboxEntry): boolean =>
  entry.mailboxType === "PublicDL" || entry.mailboxType === "PrivateDL";

/** One input string → SMTP list via ResolveNames (+ ExpandDL for DLs).
 * Resolution failures are per-input results, never throws. */
async function resolveAttendeeInput(requested: string): Promise<ResolvedInput> {
  if (requested.includes("@")) {
    return { requested, smtps: [{ smtp: requested }] };
  }
  try {
    const candidates = parseResolveNames(
      await ewsHostFetch(buildSoapEnvelope(buildResolveNamesBody(requested))),
    );
    if (candidates.length === 0) {
      return {
        requested,
        unknownReason: "not found in the directory (GAL)",
      };
    }
    if (candidates.length > 1) {
      // List the candidates so the user can pick/copy the right address.
      const listed = candidates
        .filter((c) => c.emailAddress?.includes("@"))
        .slice(0, 5)
        .map((c) => `${c.name ?? c.emailAddress} <${c.emailAddress}>`)
        .join(", ");
      return {
        requested,
        unknownReason: `ambiguous name (${candidates.length} directory matches${listed ? `: ${listed}` : ""}) — ask the user which address to use`,
      };
    }
    const candidate = candidates[0];
    if (isDl(candidate)) {
      if (!candidate.emailAddress) {
        return {
          requested,
          unknownReason: "distribution list has no address to expand",
        };
      }
      const { members, truncated } = parseExpandDl(
        await ewsHostFetch(
          buildSoapEnvelope(buildExpandDlBody(candidate.emailAddress)),
        ),
      );
      const usable = members.filter((m) => hasSmtpShape(m) && !isDl(m));
      const nestedDls = members.filter(isDl).length;
      if (usable.length === 0) {
        return {
          requested,
          unknownReason: "distribution list has no resolvable members",
        };
      }
      const noSmtp = members.length - usable.length - nestedDls;
      const notChecked: string[] = [];
      if (noSmtp > 0) {
        notChecked.push(
          `${noSmtp} member(s) of "${requested}" not checked — no SMTP address`,
        );
      }
      if (truncated) {
        notChecked.push(
          `member list of "${requested}" was truncated by the server — not all members were checked`,
        );
      }
      return {
        requested,
        smtps: usable.map((m, index) => ({
          smtp: m.emailAddress as string,
          // Surface skipped nested DLs once, on the first member.
          ...(index === 0 && nestedDls > 0
            ? {
                caveat: `${nestedDls} nested distribution list(s) inside "${requested}" were not expanded`,
              }
            : {}),
        })),
        ...(notChecked.length > 0 ? { notChecked } : {}),
      };
    }
    if (!hasSmtpShape(candidate)) {
      return {
        requested,
        unknownReason:
          "resolved without an SMTP address — use an email address",
      };
    }
    return {
      requested,
      smtps: [{ smtp: candidate.emailAddress as string }],
    };
  } catch (error) {
    return {
      requested,
      unknownReason: `name resolution failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Colleague free/busy over `range` (ERMAIN-434): resolve every input to SMTP
 * (ResolveNames/ExpandDL for GAL names and DLs), then ONE GetUserAvailability
 * with all resolved mailboxes (RequestedView FreeBusy — opaque). Per-attendee
 * failures become `status: "unknown"` entries; only the availability call
 * itself THROWS (degrading the leg). No impersonation anywhere: the host leg
 * acts as the signed-in user, and Exchange free/busy sharing is the consent
 * gate for what comes back.
 */
export async function fetchAttendeeAvailabilityViaEws(
  range: CalendarRange,
  attendees: string[],
  options: CalendarFetchOptions = {},
): Promise<NormalizedAttendeeAvailability[]> {
  if (attendees.length === 0) return [];
  throwIfAborted(options.signal);

  const resolvedInputs = await Promise.all(attendees.map(resolveAttendeeInput));
  throwIfAborted(options.signal);

  // Spend the mailbox budget in input order; overflow entries stay visible as
  // "unknown" rather than silently dropping off.
  const entries: NormalizedAttendeeAvailability[] = [];
  const toQuery: string[] = [];
  for (const resolved of resolvedInputs) {
    if ("unknownReason" in resolved) {
      entries.push({
        requested: resolved.requested,
        status: "unknown",
        reason: resolved.unknownReason,
        busy: [],
      });
      continue;
    }
    const budget = EWS_MAX_RESOLVED_MAILBOXES - toQuery.length;
    const taking = resolved.smtps.slice(0, Math.max(0, budget));
    const dropped = resolved.smtps.length - taking.length;
    for (const { smtp, caveat } of taking) {
      toQuery.push(smtp);
      entries.push({
        requested: resolved.requested,
        smtp,
        status: "ok", // provisional; zipped with the free/busy result below
        ...(caveat !== undefined ? { reason: caveat } : {}),
        busy: [],
      });
    }
    if (dropped > 0) {
      entries.push({
        requested: resolved.requested,
        status: "unknown",
        reason: `attendee cap reached (${EWS_MAX_RESOLVED_MAILBOXES} mailboxes) — ${dropped} not checked`,
        busy: [],
      });
    }
    for (const reason of resolved.notChecked ?? []) {
      entries.push({
        requested: resolved.requested,
        status: "unknown",
        reason,
        busy: [],
      });
    }
  }

  if (toQuery.length > 0) {
    const doc = await ewsHostFetch(
      buildSoapEnvelope(
        buildGetUserAvailabilityBody(
          toQuery,
          range.startUtc,
          range.endUtc,
          "FreeBusy",
        ),
      ),
    );
    const results = parseAttendeeFreeBusy(doc, range.startUtc);
    if (results.length === toQuery.length) {
      let cursor = 0;
      for (const entry of entries) {
        if (entry.smtp === undefined) continue; // unresolved — no response slot
        const result = results[cursor];
        cursor += 1;
        if (result === undefined) {
          entry.status = "unknown";
          entry.reason = "no free/busy response for this mailbox";
        } else if (result.kind === "error") {
          entry.status = "unknown";
          entry.reason = result.reason;
        } else {
          entry.busy = result.blocks;
        }
      }
    } else {
      // Responses carry no identity, so they match mailboxes only by position —
      // sound ONLY at 1:1 (validated on SE: a bad or duplicate mailbox still
      // gets its own in-order slot). A count divergence means position can't be
      // trusted, so don't guess — every queried mailbox degrades to unknown
      // rather than silently inherit a neighbour's calendar.
      console.warn(
        `[fetchAttendeeAvailabilityViaEws] expected ${toQuery.length} FreeBusyResponses, got ${results.length}; marking all unknown`,
      );
      for (const entry of entries) {
        if (entry.smtp === undefined) continue;
        entry.status = "unknown";
        entry.reason = "free/busy response count mismatch";
      }
    }
  }
  return entries;
}

/** The full EWS calendar snapshot. After the `getEwsUrl()` precheck this NEVER
 * throws except to propagate an abort — a failed leg degrades to `[]` / null
 * and is named in `degradedLegs`. */
export async function fetchOutlookCalendarViaEws(
  options: CalendarFetchOptions = {},
): Promise<NormalizedCalendar> {
  // Precheck: EWS must be reachable on this mailbox (throws if `ewsUrl` absent).
  getEwsUrl();

  const { historyRange, busyRange } = computeCalendarRanges(
    new Date(),
    options,
  );
  const displayTimeZone = resolveTimezone();

  const {
    historyMeetings,
    busyBlocks,
    workingHours,
    attendeeAvailability,
    degradedLegs,
  } = await runCalendarLegs(
    {
      history: () => fetchCalendarHistoryViaEws(historyRange, options),
      busy: () => fetchCalendarBusyViaEws(busyRange, options),
      workingHours: () => fetchWorkingHoursViaEws(busyRange, options),
      attendees: () =>
        fetchAttendeeAvailabilityViaEws(
          busyRange,
          options.attendees ?? [],
          options,
        ),
    },
    options.signal,
    "[fetchOutlookCalendarViaEws]",
  );

  return {
    workingHours,
    busyBlocks,
    historyMeetings,
    attendees: attendeeAvailability,
    displayTimeZone,
    degradedLegs,
  };
}
