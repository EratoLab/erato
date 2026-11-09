import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import ScheduledItemFormPage from "../ScheduledItemFormPage";

import type {
  ScheduledItem,
  ScheduledItemsResponse,
  ScheduledTemplatesResponse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

const pageAlignment = vi.hoisted(() => () => ({
  containerClasses: "container",
  horizontalPadding: "px-4",
  justifyAlignment: "justify-center",
}));

vi.mock("@/hooks/ui", () => ({ usePageAlignment: pageAlignment }));

vi.mock("@/hooks/ui/useThemedIcon", () => ({
  useThemedIcon: () => null,
}));

let list: ScheduledItemsResponse;
const connectedList: ScheduledItemsResponse = {
  items: [],
  upcoming_count: 0,
  past_count: 0,
  time_zone: "Europe/Berlin",
  time_zone_source: "user",
  channels: [{ channel: "teams_personal", status: "connected" }],
  max_upcoming: 10,
};

const templates: ScheduledTemplatesResponse = {
  templates: [
    {
      id: "follow-up-offer",
      type: "reminder",
      title: "Follow up on an offer",
      description: "Ask whether they decided",
      name: "Follow up on the offer",
      message: "Ask whether they need the revised rates.",
    },
  ],
};

let existing: ScheduledItem;
const scheduledItem: ScheduledItem = {
  id: "item-1",
  type: "reminder",
  name: "Prepare the rate call",
  message: "Bring the comparison.",
  trigger: { kind: "once", date: "2099-01-15", time: "08:30" },
  time_zone: "Europe/Berlin",
  status: "scheduled",
  next_occurrence: { at: "2099-01-15T07:30:00Z", local: "2099-01-15T08:30:00" },
  occurrence_count: 1,
  channel: "teams_personal",
  channel_status: "connected",
  linked_chat: { id: "chat-old", title: "An older chat" },
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-01T10:00:00Z",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

let fetchMock: ReturnType<typeof vi.fn>;
let writeResponse: () => Response;

const renderAt = (path: string, teamsAppName: string | null = null) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <StaticFeatureConfigProvider
        config={{ scheduled: { enabled: true, teamsAppName } }}
      >
        <I18nProvider i18n={i18n}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/scheduled" element={<p>Scheduled list</p>} />
              <Route
                path="/scheduled/new"
                element={<ScheduledItemFormPage />}
              />
              <Route
                path="/scheduled/:itemId/edit"
                element={<ScheduledItemFormPage />}
              />
            </Routes>
          </MemoryRouter>
        </I18nProvider>
      </StaticFeatureConfigProvider>
    </QueryClientProvider>,
  );

const requestTo = (method: string, url: string) =>
  fetchMock.mock.calls.find(
    ([calledUrl, init]) =>
      calledUrl === url && (init as RequestInit | undefined)?.method === method,
  ) as [string, RequestInit] | undefined;

describe("ScheduledItemFormPage", () => {
  beforeEach(() => {
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
    list = connectedList;
    existing = scheduledItem;
    writeResponse = () => json(existing, 201);
    fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") return Promise.resolve(writeResponse());
      if (url.startsWith("/api/v1beta/me/scheduled-items?")) {
        return Promise.resolve(json(list));
      }
      if (url === "/api/v1beta/me/scheduled-items/item-1") {
        return Promise.resolve(json(existing));
      }
      if (url === "/api/v1beta/me/scheduled-templates") {
        return Promise.resolve(json(templates));
      }
      if (url.startsWith("/api/v1beta/me/recent_chats")) {
        return Promise.resolve(
          json({
            chats: [{ id: "chat-1", title_resolved: "Offer Müller GmbH" }],
            stats: { total_count: 1, current_offset: 0 },
          }),
        );
      }
      return Promise.resolve(json({}, 404));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens a template prefilled and schedules it", async () => {
    renderAt("/scheduled/new?template=follow-up-offer");

    expect(
      await screen.findByText(
        "Filled in from the template “Follow up on an offer”. Change anything you like.",
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByDisplayValue("Follow up on the offer"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "New reminder" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Schedule reminder" }));

    expect(await screen.findByText("Scheduled list")).toBeInTheDocument();
    const [, init] = requestTo("POST", "/api/v1beta/me/scheduled-items")!;
    expect(JSON.parse(init.body as string)).toMatchObject({
      type: "reminder",
      name: "Follow up on the offer",
      message: "Ask whether they need the revised rates.",
      linked_chat_id: null,
      channel: "teams_personal",
      trigger: { kind: "once", time: "09:00" },
    });
  });

  it("puts a refused time on the date and stays on the form", async () => {
    writeResponse = () =>
      json(
        {
          code: "trigger_in_past",
          message: "The schedule has no time in the future.",
        },
        422,
      );
    renderAt("/scheduled/new?template=follow-up-offer");
    await screen.findByDisplayValue("Follow up on the offer");

    fireEvent.click(screen.getByRole("button", { name: "Schedule reminder" }));

    expect(
      await screen.findByText(
        "This time is in the past. Pick a time in the future.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await waitFor(() => expect(screen.getByLabelText("Date")).toHaveFocus());
    expect(screen.queryByText("Scheduled list")).not.toBeInTheDocument();
  });

  it("shows the limit as an alert on the form", async () => {
    writeResponse = () =>
      json({ code: "limit_reached", message: "Limit." }, 409);
    renderAt("/scheduled/new?template=follow-up-offer");
    await screen.findByDisplayValue("Follow up on the offer");

    fireEvent.click(screen.getByRole("button", { name: "Schedule reminder" }));

    const alert = await screen.findByTestId("scheduled-form-error");
    expect(alert).toHaveTextContent(
      "You have the maximum number of upcoming items. Cancel one first.",
    );
    await waitFor(() => expect(alert.parentElement).toHaveFocus());
  });

  it("opens the delivery settings up front when no channel is connected", async () => {
    list = {
      ...connectedList,
      channels: [{ channel: "teams_personal", status: "not_set_up" }],
    };
    renderAt("/scheduled/new?template=follow-up-offer", "Hugo");
    await screen.findByDisplayValue("Follow up on the offer");

    expect(
      screen.getByRole("button", { name: "Advanced settings" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText(/Hugo can't reach you in Teams yet/),
    ).toBeInTheDocument();
  });

  it("names the configured Teams app in the setup hint", async () => {
    list = {
      ...connectedList,
      channels: [{ channel: "teams_personal", status: "not_set_up" }],
    };
    renderAt("/scheduled/new", "Hugo");

    expect(
      await screen.findByText(
        "Hugo can't reach you in Teams yet. Open Hugo in Microsoft Teams once: under Apps, search for Hugo and open it. After that, this channel works.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the delivery settings closed while a channel is connected", async () => {
    renderAt("/scheduled/new?template=follow-up-offer");
    await screen.findByDisplayValue("Follow up on the offer");

    expect(
      screen.getByRole("button", { name: "Advanced settings" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("edits a snoozed item with its own schedule and says the snooze", async () => {
    existing = {
      ...scheduledItem,
      status: "snoozed",
      next_occurrence: {
        at: "2099-01-16T08:00:00Z",
        local: "2099-01-16T09:00:00",
      },
    };
    renderAt("/scheduled/item-1/edit");
    await screen.findByDisplayValue("Prepare the rate call");

    expect(screen.getByLabelText("Date")).toHaveValue("2099-01-15");
    expect(screen.getByTestId("scheduled-trigger-summary")).toHaveTextContent(
      "Snoozed until Fri, Jan 16, 9:00 AM. Changing the schedule replaces the snooze.",
    );
  });

  it("edits an item as stored and saves it with PUT", async () => {
    writeResponse = () => json(existing);
    renderAt("/scheduled/item-1/edit");

    expect(
      await screen.findByDisplayValue("Prepare the rate call"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Edit reminder" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toHaveValue("2099-01-15");
    expect(screen.getByRole("combobox", { name: "Linked chat" })).toHaveValue(
      "chat-old",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(
        requestTo("PUT", "/api/v1beta/me/scheduled-items/item-1"),
      ).toBeDefined(),
    );
    const [, init] = requestTo("PUT", "/api/v1beta/me/scheduled-items/item-1")!;
    expect(JSON.parse(init.body as string)).toMatchObject({
      linked_chat_id: "chat-old",
      trigger: { kind: "once", date: "2099-01-15", time: "08:30" },
    });
  });

  it("schedules an earlier item again from its content", async () => {
    renderAt("/scheduled/new?from=item-1");

    expect(
      await screen.findByText(
        "Filled in from “Prepare the rate call”. Pick when it should happen again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Bring the comparison."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Time")).toHaveValue("08:30");
  });
});
