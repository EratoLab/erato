import { i18n } from "@lingui/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScheduledItems } from "../useScheduledItems";

import type {
  ScheduledItem,
  ScheduledItemsResponse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

const toastError = vi.hoisted(() => vi.fn());

vi.mock("@/components/ui/Toast/usePageErrorToast", () => ({
  usePageErrorToast: () => toastError,
}));

const upcomingItem: ScheduledItem = {
  id: "item-upcoming",
  type: "reminder",
  name: "Follow up on the offer",
  message: "Ask whether they decided.",
  trigger: { kind: "once", date: "2026-11-13", time: "10:00" },
  time_zone: "Europe/Berlin",
  status: "scheduled",
  next_occurrence: { at: "2026-11-13T09:00:00Z", local: "2026-11-13T10:00:00" },
  occurrence_count: 1,
  channel: "teams_personal",
  channel_status: "connected",
  created_at: "2026-11-07T10:00:00Z",
  updated_at: "2026-11-07T10:00:00Z",
};

const pastItem: ScheduledItem = {
  ...upcomingItem,
  id: "item-past",
  name: "Book the trucks",
  status: "done",
  next_occurrence: null,
  last_delivery: {
    due: { at: "2026-11-04T08:00:00Z", local: "2026-11-04T09:00:00" },
    outcome: "delivered",
  },
};

const listResponse = (items: ScheduledItem[]): ScheduledItemsResponse => ({
  items,
  upcoming_count: 1,
  past_count: 140,
  time_zone: "Europe/Berlin",
  time_zone_source: "user",
  channels: [{ channel: "teams_personal", status: "connected" }],
  max_upcoming: 10,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("useScheduledItems", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  );

  beforeEach(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
    toastError.mockReset();
    fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "GET") {
        return Promise.resolve(
          json(
            listResponse(
              url.endsWith("tab=past") ? [pastItem] : [upcomingItem],
            ),
          ),
        );
      }
      if (url.endsWith("/snooze")) return Promise.resolve(json(upcomingItem));
      return Promise.resolve(
        json({ code: "finished", message: "This item is already over." }, 409),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists both tabs with the API's counts, zone and channel state", async () => {
    const { result } = renderHook(() => useScheduledItems(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items.map((item) => [item.id, item.tab])).toEqual([
      ["item-upcoming", "upcoming"],
      ["item-past", "past"],
    ]);
    expect(result.current.counts).toEqual({ upcoming: 1, past: 140 });
    expect(result.current.timeZone).toBe("Europe/Berlin");
    expect(result.current.notice).toBeNull();
  });

  it("snoozes to tomorrow morning in the user's zone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
    const { result } = renderHook(() => useScheduledItems(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.snooze(result.current.items[0]));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1beta/me/scheduled-items/item-upcoming/snooze",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ until: "2026-11-08T08:00:00.000Z" }),
        }),
      ),
    );
    vi.useRealTimers();
  });

  it("shows a refusal as an error toast", async () => {
    const { result } = renderHook(() => useScheduledItems(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.cancel(result.current.items[0]));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith({
        title: "“Follow up on the offer” could not be cancelled",
        description: "This item is already over.",
      }),
    );
  });

  it("deletes a past item through the API", async () => {
    const { result } = renderHook(() => useScheduledItems(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.remove(result.current.items[1]));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1beta/me/scheduled-items/item-past",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
});
