import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { outlookAppointmentFingerprint } from "../../utils/outlookActionFacet";
import { useLiveComposeFields } from "../useLiveComposeFields";

import type { AppointmentComposeSnapshot } from "../../providers/OutlookMailItemProvider";

const readSnapshot = vi.hoisted(() => vi.fn());

vi.mock("../../providers/OutlookMailItemProvider", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readAppointmentComposeSnapshot: readSnapshot,
}));

const eventTypes = Office.EventType as unknown as Record<
  string,
  string | undefined
>;

const fallback: AppointmentComposeSnapshot = {
  subject: "Planning",
  organizer: null,
  requiredAttendees: [],
  optionalAttendees: [],
  location: "",
  start: null,
  end: null,
  bodyText: "Agenda",
  bodyHtml: null,
};

type Handler = () => void;

function mockItem(extra: Record<string, unknown> = {}) {
  const handlers = new Map<string, Handler>();
  const item: Record<string, unknown> & {
    addHandlerAsync: ReturnType<typeof vi.fn>;
    removeHandlerAsync: ReturnType<typeof vi.fn>;
  } = {
    subject: {},
    addHandlerAsync: vi.fn((eventType: string, handler: Handler) => {
      handlers.set(eventType, handler);
    }),
    removeHandlerAsync: vi.fn((eventType: string) => {
      handlers.delete(eventType);
    }),
    ...extra,
  };
  (Office.context as unknown as Record<string, unknown>).mailbox = { item };
  return { item, handlers };
}

const recipientsField = (addresses: string[]) => ({
  getAsync: (callback: (result: unknown) => void) =>
    callback({
      status: Office.AsyncResultStatus.Succeeded,
      value: addresses.map((emailAddress) => ({
        displayName: emailAddress,
        emailAddress,
      })),
    }),
});

describe("useLiveComposeFields", () => {
  beforeEach(() => {
    eventTypes.RecipientsChanged = "olkRecipientsChanged";
    eventTypes.AppointmentTimeChanged = "olkAppointmentTimeChanged";
    eventTypes.EnhancedLocationsChanged = "olkEnhancedLocationsChanged";
  });

  afterEach(() => {
    delete eventTypes.RecipientsChanged;
    delete eventTypes.AppointmentTimeChanged;
    delete eventTypes.EnhancedLocationsChanged;
    vi.clearAllMocks();
  });

  it("knows nothing until the host reports a recipient edit, then reads them", async () => {
    const { item, handlers } = mockItem({ to: recipientsField(["a@x"]) });
    const { result } = renderHook(() =>
      useLiveComposeFields({
        watch: "recipients",
        itemIdentity: "draft-1",
        appointmentFallback: fallback,
      }),
    );

    expect(result.current).toEqual({});
    expect(item.addHandlerAsync).toHaveBeenCalledTimes(1);

    item.to = recipientsField(["a@x", "b@x"]);
    act(() => handlers.get("olkRecipientsChanged")?.());

    await waitFor(() =>
      expect(result.current.recipients).toBe(
        JSON.stringify({
          to: [
            { displayName: "a@x", emailAddress: "a@x" },
            { displayName: "b@x", emailAddress: "b@x" },
          ],
        }),
      ),
    );
    // The draft's detail lists them as the next send reads them.
    expect(result.current.recipientList).toEqual({
      to: [
        { displayName: "a@x", emailAddress: "a@x" },
        { displayName: "b@x", emailAddress: "b@x" },
      ],
    });
    expect(result.current.appointment).toBeUndefined();
  });

  it("re-reads the appointment on time, attendee and location edits", async () => {
    const { item, handlers } = mockItem({ itemType: "appointment" });
    const moved = { ...fallback, location: "Room 3" };
    readSnapshot.mockResolvedValue(moved);
    const { result } = renderHook(() =>
      useLiveComposeFields({
        watch: "appointment",
        itemIdentity: "appt-1",
        appointmentFallback: fallback,
      }),
    );

    expect([...handlers.keys()]).toEqual([
      "olkRecipientsChanged",
      "olkAppointmentTimeChanged",
      "olkEnhancedLocationsChanged",
    ]);
    expect(result.current.appointment).toBeUndefined();
    act(() => handlers.get("olkEnhancedLocationsChanged")?.());

    await waitFor(() =>
      expect(result.current.appointmentFingerprint).toBe(
        outlookAppointmentFingerprint(moved),
      ),
    );
    expect(result.current.appointment).toEqual(moved);
    expect(readSnapshot).toHaveBeenCalledWith(item, fallback);
  });

  it("forgets what it read when another item opens, and unregisters", async () => {
    const { item, handlers } = mockItem({ to: recipientsField(["a@x"]) });
    const { result, rerender, unmount } = renderHook(
      ({ itemIdentity }) =>
        useLiveComposeFields({
          watch: "recipients",
          itemIdentity,
          appointmentFallback: fallback,
        }),
      { initialProps: { itemIdentity: "draft-1" } },
    );
    act(() => handlers.get("olkRecipientsChanged")?.());
    await waitFor(() => expect(result.current.recipients).toBeDefined());

    rerender({ itemIdentity: "draft-2" });
    expect(result.current).toEqual({});
    expect(item.removeHandlerAsync).toHaveBeenCalledWith(
      "olkRecipientsChanged",
    );

    unmount();
    expect(item.removeHandlerAsync).toHaveBeenCalledTimes(2);
  });

  it("registers nothing on a host without the events or for a read item", () => {
    delete eventTypes.RecipientsChanged;
    const { item } = mockItem();
    renderHook(() =>
      useLiveComposeFields({
        watch: "recipients",
        itemIdentity: "draft-1",
        appointmentFallback: fallback,
      }),
    );
    expect(item.addHandlerAsync).not.toHaveBeenCalled();

    eventTypes.RecipientsChanged = "olkRecipientsChanged";
    const read = mockItem({ subject: "Received" });
    renderHook(() =>
      useLiveComposeFields({
        watch: "recipients",
        itemIdentity: "read-1",
        appointmentFallback: fallback,
      }),
    );
    expect(read.item.addHandlerAsync).not.toHaveBeenCalled();
  });
});
