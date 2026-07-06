import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AppointmentFormError,
  isCreateAppointmentSupported,
  openNewAppointmentForm,
  parseAppointmentDetails,
} from "../outlookCreateAppointment";

type OfficeGlobal = { Office?: unknown };

function installOffice({
  supportedSets = ["Mailbox 1.1", "Mailbox 1.9"],
  hostName = "Outlook",
  displayNewAppointmentFormAsync = vi.fn(
    (_form: unknown, cb: (r: { status: string; value: undefined }) => void) =>
      cb({ status: "succeeded", value: undefined }),
  ),
  displayNewAppointmentForm = vi.fn(),
}: {
  supportedSets?: string[];
  hostName?: string;
  displayNewAppointmentFormAsync?: ReturnType<typeof vi.fn>;
  displayNewAppointmentForm?: ReturnType<typeof vi.fn>;
} = {}) {
  (globalThis as OfficeGlobal).Office = {
    AsyncResultStatus: { Succeeded: "succeeded", Failed: "failed" },
    context: {
      mailbox: {
        diagnostics: { hostName },
        displayNewAppointmentFormAsync,
        displayNewAppointmentForm,
      },
      requirements: {
        isSetSupported: (name: string, version: string) =>
          supportedSets.includes(`${name} ${version}`),
      },
    },
  };
  return { displayNewAppointmentFormAsync, displayNewAppointmentForm };
}

afterEach(() => {
  delete (globalThis as OfficeGlobal).Office;
  vi.restoreAllMocks();
});

const VALID = {
  start: "2026-07-09T10:00:00+02:00",
  end: "2026-07-09T10:30:00+02:00",
  subject: "Projekt-Sync",
  attendees: ["alice@example.com"],
};

describe("parseAppointmentDetails", () => {
  it("parses a valid payload with optional fields", () => {
    expect(
      parseAppointmentDetails(
        JSON.stringify({
          ...VALID,
          optionalAttendees: ["bob@example.com"],
          location: "Raum 3",
          body: "Agenda folgt.",
        }),
      ),
    ).toEqual({
      ...VALID,
      optionalAttendees: ["bob@example.com"],
      location: "Raum 3",
      body: "Agenda folgt.",
    });
  });

  it("tolerates missing subject/attendees and non-string entries", () => {
    expect(
      parseAppointmentDetails(
        JSON.stringify({
          start: VALID.start,
          end: VALID.end,
          attendees: ["a@example.com", 42, null],
        }),
      ),
    ).toEqual({
      start: VALID.start,
      end: VALID.end,
      subject: "",
      attendees: ["a@example.com"],
    });
  });

  it("returns null for malformed or incomplete payloads", () => {
    // Mid-stream truncation is the common case: never throw, never card.
    expect(parseAppointmentDetails('{ "start": "2026-07-09T10')).toBeNull();
    expect(parseAppointmentDetails("")).toBeNull();
    expect(parseAppointmentDetails("[]")).toBeNull();
    expect(parseAppointmentDetails('"just a string"')).toBeNull();
    expect(
      parseAppointmentDetails(JSON.stringify({ start: VALID.start })),
    ).toBeNull();
    expect(
      parseAppointmentDetails(JSON.stringify({ ...VALID, end: 1234 })),
    ).toBeNull();
  });

  it("returns null when start/end don't parse as dates", () => {
    expect(
      parseAppointmentDetails(
        JSON.stringify({ ...VALID, start: "next Tuesday" }),
      ),
    ).toBeNull();
  });
});

describe("isCreateAppointmentSupported", () => {
  it("requires Mailbox 1.1", () => {
    installOffice();
    expect(isCreateAppointmentSupported()).toBe(true);
    installOffice({ supportedSets: [] });
    expect(isCreateAppointmentSupported()).toBe(false);
  });

  it("is false on Outlook mobile, where the form API is unsupported", () => {
    installOffice({ hostName: "OutlookIOS" });
    expect(isCreateAppointmentSupported()).toBe(false);
    installOffice({ hostName: "OutlookAndroid" });
    expect(isCreateAppointmentSupported()).toBe(false);
    installOffice({ hostName: "OutlookWebApp" });
    expect(isCreateAppointmentSupported()).toBe(true);
  });
});

describe("openNewAppointmentForm", () => {
  it("prefills the async form on Mailbox 1.9 hosts (attendees, times, no recurrence)", async () => {
    const { displayNewAppointmentFormAsync } = installOffice();
    await openNewAppointmentForm({
      ...VALID,
      optionalAttendees: ["bob@example.com"],
      location: "Raum 3",
      body: "Agenda folgt.",
    });
    expect(displayNewAppointmentFormAsync).toHaveBeenCalledTimes(1);
    const form = displayNewAppointmentFormAsync.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(form).toEqual({
      requiredAttendees: ["alice@example.com"],
      optionalAttendees: ["bob@example.com"],
      start: new Date(VALID.start),
      end: new Date(VALID.end),
      subject: "Projekt-Sync",
      location: "Raum 3",
      body: "Agenda folgt.",
    });
    expect(form).not.toHaveProperty("recurrence");
  });

  it("falls back to the sync form without Mailbox 1.9", async () => {
    const { displayNewAppointmentForm, displayNewAppointmentFormAsync } =
      installOffice({ supportedSets: ["Mailbox 1.1"] });
    await openNewAppointmentForm(VALID);
    expect(displayNewAppointmentForm).toHaveBeenCalledTimes(1);
    expect(displayNewAppointmentFormAsync).not.toHaveBeenCalled();
  });

  it("wraps host failures in AppointmentFormError", async () => {
    installOffice({
      displayNewAppointmentFormAsync: vi.fn(() => {
        throw new Error("host says no");
      }),
    });
    await expect(openNewAppointmentForm(VALID)).rejects.toBeInstanceOf(
      AppointmentFormError,
    );
  });

  it("rejects when the async callback reports failure", async () => {
    installOffice({
      displayNewAppointmentFormAsync: vi.fn(
        (
          _form: unknown,
          cb: (r: {
            status: string;
            value: undefined;
            error: { message: string };
          }) => void,
        ) =>
          cb({
            status: "failed",
            value: undefined,
            error: { message: "denied" },
          }),
      ),
    });
    await expect(openNewAppointmentForm(VALID)).rejects.toThrow();
  });
});
