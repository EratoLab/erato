import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { setClientPlatform } from "@/lib/clientPlatform";
import { messages as enMessages } from "@/locales/en/messages.json";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import { ReminderConfirmationCard } from "../ReminderConfirmationCard";

import type { ReminderConfirmation } from "../reminderConfirmation";
import type { ScheduledItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";
import type { ReactNode } from "react";

const confirmation: ReminderConfirmation = {
  itemId: "item-1",
  heading: "Reminder scheduled",
  name: "Follow up on the offer",
  when: "Friday, 13 Nov, 10:00 (New York time)",
  repeats: null,
  delivery: "Delivered via Teams chat",
  cancelLabel: "Cancel",
  openScheduledLabel: "Open in Scheduled",
  scheduledPath: "/scheduled",
};

const storedItem = (status: ScheduledItem["status"]): ScheduledItem => ({
  id: "item-1",
  type: "reminder",
  name: "Follow up on the offer",
  message: "Ask whether they decided.",
  trigger: { kind: "once", date: "2026-11-13", time: "10:00" },
  time_zone: "America/New_York",
  status,
  occurrence_count: 1,
  channel: "teams_personal",
  channel_status: "connected",
  created_at: "2026-11-08T10:00:00Z",
  updated_at: "2026-11-08T10:00:00Z",
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const renderCard = ({
  scheduledPage = true,
  router = true,
}: { scheduledPage?: boolean; router?: boolean } = {}) => {
  const card = <ReminderConfirmationCard confirmation={confirmation} />;
  const withRouter = (ui: ReactNode) =>
    router ? (
      <MemoryRouter initialEntries={["/chat/chat-1"]}>
        <Routes>
          <Route path="/chat/:id" element={ui} />
          <Route path="/scheduled" element={<p>Scheduled page</p>} />
        </Routes>
      </MemoryRouter>
    ) : (
      ui
    );
  return render(
    <I18nProvider i18n={i18n}>
      <StaticFeatureConfigProvider
        config={{ scheduled: { enabled: scheduledPage } }}
      >
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          {withRouter(card)}
        </QueryClientProvider>
      </StaticFeatureConfigProvider>
    </I18nProvider>,
  );
};

describe("ReminderConfirmationCard", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let current: ScheduledItem["status"] | null;
  let cancelResponse: () => Response;

  beforeAll(() => {
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  beforeEach(() => {
    current = "scheduled";
    cancelResponse = () => {
      current = "cancelled";
      return json(storedItem("cancelled"));
    };
    fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/cancel") && init?.method === "POST") {
        return Promise.resolve(cancelResponse());
      }
      return Promise.resolve(
        current
          ? json(storedItem(current))
          : json({ code: "not_found", message: "Not found." }, 404),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setClientPlatform("web");
  });

  it("shows what was stored, worded by the backend", async () => {
    renderCard();

    const card = screen.getByRole("region", {
      name: "Reminder scheduled: Follow up on the offer",
    });
    expect(card).toHaveTextContent("Reminder scheduled");
    expect(card).toHaveTextContent("Follow up on the offer");
    expect(card).toHaveTextContent("Friday, 13 Nov, 10:00 (New York time)");
    expect(card).toHaveTextContent("Delivered via Teams chat");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /edit/i }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(card).toHaveAttribute("data-status", "scheduled"),
    );
    // Scheduled is what the heading already says.
    expect(card).not.toHaveTextContent("Cancelled");
  });

  it("cancels through the cancel endpoint and then shows it cancelled", async () => {
    renderCard();
    const card = screen.getByTestId("reminder-confirmation");
    await waitFor(() =>
      expect(card).toHaveAttribute("data-status", "scheduled"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(card).toHaveAttribute("data-status", "cancelled"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1beta/me/scheduled-items/item-1/cancel",
      expect.objectContaining({ method: "POST" }),
    );
    expect(card).toHaveTextContent("Cancelled");
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("reminder-confirmation-open")).toHaveTextContent(
      "Open in Scheduled",
    );
  });

  it("says why Cancel was refused and stops offering it once over", async () => {
    cancelResponse = () => {
      current = "done";
      return json({ code: "finished", message: "Already over." }, 409);
    };
    renderCard();
    const card = screen.getByTestId("reminder-confirmation");
    await waitFor(() =>
      expect(card).toHaveAttribute("data-status", "scheduled"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This item is already over.",
    );
    await waitFor(() => expect(card).toHaveAttribute("data-status", "done"));
    expect(card).toHaveTextContent("Done");
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
  });

  it("offers no Cancel on a reloaded card whose reminder already happened", async () => {
    current = "done";
    renderCard();

    const card = screen.getByTestId("reminder-confirmation");
    await waitFor(() => expect(card).toHaveAttribute("data-status", "done"));
    expect(card).toHaveTextContent("Done");
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
  });

  it("keeps Cancel on a snoozed reminder, which is still upcoming", async () => {
    current = "snoozed";
    renderCard();

    const card = screen.getByTestId("reminder-confirmation");
    await waitFor(() => expect(card).toHaveAttribute("data-status", "snoozed"));
    expect(card).toHaveTextContent("Snoozed");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("says when the reminder no longer exists", async () => {
    current = null;
    renderCard();

    expect(
      await screen.findByText("This reminder no longer exists."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
  });

  it("opens the Scheduled page inside the app", async () => {
    renderCard();

    const open = screen.getByTestId("reminder-confirmation-open");
    expect(open).toHaveAttribute("href", "/scheduled");
    expect(open).not.toHaveAttribute("target");
    fireEvent.click(open);

    expect(await screen.findByText("Scheduled page")).toBeInTheDocument();
  });

  it("opens the Scheduled page in a new tab from another host", () => {
    setClientPlatform("outlook");
    renderCard();

    const open = screen.getByTestId("reminder-confirmation-open");
    expect(open).toHaveAttribute("href", "/scheduled");
    expect(open).toHaveAttribute("target", "_blank");
  });

  it("drops Open in Scheduled where the app has no Scheduled page", () => {
    renderCard({ scheduledPage: false, router: false });

    expect(
      screen.queryByTestId("reminder-confirmation-open"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});
