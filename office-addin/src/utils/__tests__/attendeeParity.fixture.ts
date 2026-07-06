import type { NormalizedAttendeeAvailability } from "../fetchOutlookCalendar";

/**
 * The SHARED attendee-availability parity contract (ERMAIN-434): both backend
 * test suites feed equivalent wire fixtures — EXO `getSchedule` scheduleItems
 * vs SE `GetUserAvailability` CalendarEventArray, same instants, same
 * free/busy states, plus one denied mailbox — and assert THIS exact
 * normalized output. Any drift between the backends breaks one of the two
 * suites against the common expectation.
 *
 * Contract highlights: blocking-only busy (the `Free` event both fixtures
 * carry must vanish), no subjects (opaque), UTC `…Z` instants, denied →
 * `status: "unknown"` with empty busy. `reason` is backend-worded free text,
 * so parity is asserted on the reason-stripped shape via {@link stripReasons}.
 */
export const EXPECTED_ATTENDEE_PARITY: Omit<
  NormalizedAttendeeAvailability,
  "reason"
>[] = [
  {
    requested: "alice@example.de",
    smtp: "alice@example.de",
    status: "ok",
    busy: [
      {
        when: {
          kind: "date-time",
          startUtc: "2026-07-07T08:00:00Z",
          endUtc: "2026-07-07T09:00:00Z",
        },
        busyType: "Busy",
      },
      {
        when: {
          kind: "date-time",
          startUtc: "2026-07-07T12:00:00Z",
          endUtc: "2026-07-07T12:30:00Z",
        },
        busyType: "Tentative",
      },
      {
        when: {
          kind: "date-time",
          startUtc: "2026-07-08T08:00:00Z",
          endUtc: "2026-07-08T16:00:00Z",
        },
        busyType: "OOF",
      },
    ],
  },
  {
    requested: "denied@example.de",
    // The address resolved; only the free/busy READ failed — smtp stays.
    smtp: "denied@example.de",
    status: "unknown",
    busy: [],
  },
];

export function stripReasons(
  entries: NormalizedAttendeeAvailability[],
): Omit<NormalizedAttendeeAvailability, "reason">[] {
  return entries.map(({ reason: _reason, ...rest }) => rest);
}
