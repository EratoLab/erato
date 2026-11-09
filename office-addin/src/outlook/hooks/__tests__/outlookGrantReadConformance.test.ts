import { clientToolHostAdapterConformanceFailures } from "@erato/frontend/conformance";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { FETCH_AVAILABILITY_TOOL_NAME } from "../../utils/outlookScheduleTool";
import { outlookContextStore } from "../outlookContextStore";
import { useOutlookClientTools } from "../useOutlookClientTools";

import type {
  NormalizedCalendar,
  OutlookCalendarFetcher,
} from "../../utils/fetchOutlookCalendar";
import type { ClientToolHostTurn } from "@erato/frontend/conformance";

const mocks = vi.hoisted(() => ({
  fetcher: null as OutlookCalendarFetcher | null,
}));

vi.mock("../../../providers/OfficeProvider", () => ({
  useOffice: () => ({ mailboxUser: { emailAddress: "max@example.com" } }),
}));
vi.mock("../useOutlookCalendarFetcher", () => ({
  useOutlookCalendarFetcher: () => ({
    fetcher: mocks.fetcher,
    unavailableReason: null,
  }),
}));

const calendar: NormalizedCalendar = {
  workingHours: {
    daysOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    startMinutes: 9 * 60,
    endMinutes: 17 * 60,
  },
  busyBlocks: [
    {
      when: {
        kind: "date-time",
        startUtc: "2099-01-05T09:00:00Z",
        endUtc: "2099-01-05T10:00:00Z",
      },
      busyType: "Busy",
      subject: "Weekly sync",
    },
  ],
  historyMeetings: [],
  attendees: [
    { requested: "Anna", smtp: "anna@example.com", status: "ok", busy: [] },
  ],
  displayTimeZone: "Europe/Berlin",
  degradedLegs: [],
};

beforeEach(() => {
  mocks.fetcher = { fetchCalendar: vi.fn(async () => calendar) };
  outlookContextStore.setDraftOff("conversation-1", "item-1", true);
});

afterEach(cleanup);

it("keeps the client tool host contract for delegated tasks", async () => {
  renderHook(() => useOutlookClientTools());
  let turns = 0;
  const failures = await clientToolHostAdapterConformanceFailures({
    hostContext: "outlook_mailbox",
    lossCode: "context_unavailable",
    ownerCheck: "server",
    // The turn sends only now_iso and timezone: no context version, and a
    // Send changes nothing the pane holds.
    startTurn: async (): Promise<ClientToolHostTurn> => {
      turns += 1;
      return {
        ownerChatId: `owner-chat-${turns}`,
        ownerMessageId: `owner-${turns}`,
      };
    },
    coordinatorState: () => outlookContextStore.getSnapshot(),
    reads: [
      {
        tool: FETCH_AVAILABILITY_TOOL_NAME,
        input: { lookahead_days: 7, duration_minutes: 30 },
      },
    ],
    // Outlook's writes are client actions the coordinator proposes, not executors.
    writes: [],
    writeMarkers: {
      fields: [],
      phrases: [
        "erato-appointment",
        "propose_client_action",
        "create_appointment",
      ],
    },
    blindSpots: [],
  });
  expect(failures).toEqual([]);
});
