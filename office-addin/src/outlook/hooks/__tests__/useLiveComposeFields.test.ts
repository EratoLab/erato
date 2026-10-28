import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { outlookAppointmentFingerprint } from "../../utils/outlookActionFacet";
import {
  LIVE_BODY_READ_TIMEOUT_MS,
  useLiveComposeFields,
} from "../useLiveComposeFields";

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

/** A body whose text the test edits, as typing in the item would. */
function liveBody(initial: string) {
  const body = {
    text: initial,
    getAsync: vi.fn(
      (coercion: unknown, callback: (result: unknown) => void) => {
        expect(coercion).toBe(Office.CoercionType.Text);
        callback({
          status: Office.AsyncResultStatus.Succeeded,
          value: body.text,
        });
      },
    ),
  };
  return body;
}

const message = (readRecipients = true) => ({
  watch: "message" as const,
  itemIdentity: "draft-1",
  readRecipients,
  appointmentFallback: fallback,
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
    vi.useRealTimers();
  });

  it("knows nothing until the host reports a recipient edit, then reads them", async () => {
    const { item, handlers } = mockItem({ to: recipientsField(["a@x"]) });
    const { result } = renderHook(() => useLiveComposeFields(message()));

    expect(result.current.fields).toEqual({});
    expect(item.addHandlerAsync).toHaveBeenCalledTimes(1);

    item.to = recipientsField(["a@x", "b@x"]);
    act(() => handlers.get("olkRecipientsChanged")?.());

    await waitFor(() =>
      expect(result.current.fields.recipients).toBe(
        JSON.stringify({
          to: [
            { displayName: "a@x", emailAddress: "a@x" },
            { displayName: "b@x", emailAddress: "b@x" },
          ],
        }),
      ),
    );
    // The draft's detail lists them as the next send reads them.
    expect(result.current.fields.recipientList).toEqual({
      to: [
        { displayName: "a@x", emailAddress: "a@x" },
        { displayName: "b@x", emailAddress: "b@x" },
      ],
    });
    expect(result.current.fields.appointment).toBeUndefined();
  });

  it("reads the body a send carries, which no item event reports", async () => {
    const body = liveBody("Dear Bob");
    mockItem({ body });
    const { result } = renderHook(() => useLiveComposeFields(message(false)));
    expect(result.current.fields.bodyText).toBeUndefined();

    body.text = "Dear Bob, thanks";
    let read: Awaited<ReturnType<typeof result.current.refresh>> = {};
    await act(async () => {
      read = await result.current.refresh();
    });

    expect(read).toEqual({ bodyText: "Dear Bob, thanks" });
    expect(result.current.fields).toEqual({ bodyText: "Dear Bob, thanks" });
  });

  it("re-reads when the pane gains focus, the user back from typing in the item", async () => {
    const body = liveBody("Dear Bob");
    mockItem({ body });
    const { result } = renderHook(() => useLiveComposeFields(message(false)));

    body.text = "Dear Bob, see you";
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() =>
      expect(result.current.fields.bodyText).toBe("Dear Bob, see you"),
    );
  });

  it("keeps the last body when a read fails, and never rejects", async () => {
    const body = liveBody("Dear Bob");
    mockItem({ body });
    const { result } = renderHook(() => useLiveComposeFields(message(false)));
    await act(async () => {
      await result.current.refresh();
    });

    body.getAsync.mockImplementationOnce(
      (_coercion: unknown, callback: (result: unknown) => void) =>
        callback({
          status: Office.AsyncResultStatus.Failed,
          error: { message: "busy" },
        }),
    );
    let read: Awaited<ReturnType<typeof result.current.refresh>> = {
      bodyText: "unset",
    };
    await act(async () => {
      read = await result.current.refresh();
    });

    expect(read).toEqual({});
    expect(result.current.fields.bodyText).toBe("Dear Bob");
  });

  it("gives up on a host that never answers after the bound", async () => {
    vi.useFakeTimers();
    mockItem({ body: { getAsync: vi.fn() } });
    const { result } = renderHook(() => useLiveComposeFields(message(false)));

    let settled = false;
    const pending = result.current.refresh().then((read) => {
      settled = true;
      return read;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_BODY_READ_TIMEOUT_MS - 1);
    });
    expect(settled).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(await pending).toEqual({});
  });

  it("keeps only the latest read when two overlap", async () => {
    const callbacks: ((result: unknown) => void)[] = [];
    mockItem({
      body: {
        getAsync: (_coercion: unknown, callback: (result: unknown) => void) => {
          callbacks.push(callback);
        },
      },
    });
    const { result } = renderHook(() => useLiveComposeFields(message(false)));

    const first = result.current.refresh();
    const second = result.current.refresh();
    await act(async () => {
      callbacks[1]?.({
        status: Office.AsyncResultStatus.Succeeded,
        value: "newer",
      });
      await second;
      callbacks[0]?.({
        status: Office.AsyncResultStatus.Succeeded,
        value: "older",
      });
      // The caller still gets what its own read found.
      expect(await first).toEqual({ bodyText: "older" });
    });

    expect(result.current.fields.bodyText).toBe("newer");
  });

  it("re-reads the appointment on time, attendee and location edits", async () => {
    const { item, handlers } = mockItem({ itemType: "appointment" });
    const moved = { ...fallback, location: "Room 3" };
    readSnapshot.mockResolvedValue(moved);
    const { result } = renderHook(() =>
      useLiveComposeFields({
        watch: "appointment",
        itemIdentity: "appt-1",
        readRecipients: false,
        appointmentFallback: fallback,
      }),
    );

    expect([...handlers.keys()]).toEqual([
      "olkRecipientsChanged",
      "olkAppointmentTimeChanged",
      "olkEnhancedLocationsChanged",
    ]);
    expect(result.current.fields.appointment).toBeUndefined();
    act(() => handlers.get("olkEnhancedLocationsChanged")?.());

    await waitFor(() =>
      expect(result.current.fields.appointmentFingerprint).toBe(
        outlookAppointmentFingerprint(moved),
      ),
    );
    expect(result.current.fields.appointment).toEqual(moved);
    expect(readSnapshot).toHaveBeenCalledWith(item, fallback);
  });

  it("forgets what it read when another item opens, and unregisters", async () => {
    const { item, handlers } = mockItem({ to: recipientsField(["a@x"]) });
    const { result, rerender, unmount } = renderHook(
      ({ itemIdentity }) =>
        useLiveComposeFields({ ...message(), itemIdentity }),
      { initialProps: { itemIdentity: "draft-1" } },
    );
    act(() => handlers.get("olkRecipientsChanged")?.());
    await waitFor(() => expect(result.current.fields.recipients).toBeDefined());

    rerender({ itemIdentity: "draft-2" });
    expect(result.current.fields).toEqual({});
    expect(item.removeHandlerAsync).toHaveBeenCalledWith(
      "olkRecipientsChanged",
    );

    unmount();
    expect(item.removeHandlerAsync).toHaveBeenCalledTimes(2);
  });

  it("registers nothing on a host without the events or for a read item", async () => {
    delete eventTypes.RecipientsChanged;
    const { item } = mockItem();
    renderHook(() => useLiveComposeFields(message()));
    expect(item.addHandlerAsync).not.toHaveBeenCalled();

    eventTypes.RecipientsChanged = "olkRecipientsChanged";
    const read = mockItem({ subject: "Received" });
    const { result } = renderHook(() =>
      useLiveComposeFields({ ...message(), itemIdentity: "read-1" }),
    );
    expect(read.item.addHandlerAsync).not.toHaveBeenCalled();
    expect(await result.current.refresh()).toEqual({});
  });
});
