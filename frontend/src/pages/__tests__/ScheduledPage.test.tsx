import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createScheduledItemFixtures,
  SCHEDULED_TEMPLATE_FIXTURES,
} from "@/components/ui/Scheduled/scheduledFixtures";
import { messages as enMessages } from "@/locales/en/messages.json";

import { ScheduledPageView } from "../ScheduledPage";

import type { ScheduledPageViewProps } from "../ScheduledPage";
import type { Messages } from "@lingui/core";

const pageAlignment = vi.hoisted(() => () => ({
  containerClasses: "container",
  horizontalPadding: "px-4",
  justifyAlignment: "justify-center",
}));

vi.mock("@/hooks/ui", () => ({ usePageAlignment: pageAlignment }));

vi.mock("@/hooks/ui/usePageAlignment", () => ({
  usePageAlignment: pageAlignment,
}));

vi.mock("@/hooks/useDateFnsLocale", () => ({
  useDateFnsLocale: () => undefined,
}));

vi.mock("@/hooks/ui/useThemedIcon", () => ({
  useThemedIcon: () => null,
}));

const renderView = (overrides: Partial<ScheduledPageViewProps> = {}) => {
  const props: ScheduledPageViewProps = {
    items: createScheduledItemFixtures(new Date()),
    templates: SCHEDULED_TEMPLATE_FIXTURES,
    onNewReminder: vi.fn(),
    onTemplateSelect: vi.fn(),
    onEdit: vi.fn(),
    onSnooze: vi.fn(),
    onCancel: vi.fn(),
    onOpenLinkedChat: vi.fn(),
    onScheduleAgain: vi.fn(),
    ...overrides,
  };
  render(
    <MemoryRouter>
      <I18nProvider i18n={i18n}>
        <ScheduledPageView {...props} />
      </I18nProvider>
    </MemoryRouter>,
  );
  return props;
};

describe("ScheduledPageView", () => {
  beforeEach(() => {
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  it("shows the empty state with templates when nothing is scheduled", () => {
    const props = renderView({ items: [] });

    expect(
      screen.getByRole("heading", { name: "Nothing scheduled yet" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Upcoming" })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("starter-prompt-follow-up-offer"));
    expect(props.onTemplateSelect).toHaveBeenCalledWith(
      SCHEDULED_TEMPLATE_FIXTURES[0],
    );
  });

  it("keeps the type and the channel out of page-level copy", () => {
    renderView();

    const alert = screen.getByTestId("scheduled-failure-alert");
    expect(alert).toHaveTextContent("1 item could not be carried out");
    for (const pageLevel of [
      screen.getByRole("heading", { level: 1 }).parentElement!,
      alert,
      screen.getByRole("tablist"),
    ]) {
      expect(pageLevel.textContent).not.toMatch(/Teams|reminder/i);
    }

    const row = screen.getByRole("article", {
      name: "Prepare for the Q4 rate call with Nordhafen Logistik",
    });
    expect(row).toHaveTextContent("Reminder");
    expect(row).toHaveTextContent("via Teams chat");
    expect(row).toHaveTextContent("Linked chat: Q4 rate comparison");
  });

  it("moves to Past from the failure alert, where the failed row shows", () => {
    renderView();

    expect(screen.getByRole("tab", { name: "Upcoming (4)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Show in Past" }));

    expect(screen.getByRole("tab", { name: "Past (4)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const failed = screen.getByRole("article", {
      name: "Check the customs clearance status",
    });
    expect(within(failed).getByText("Failed")).toBeInTheDocument();
    expect(failed).toHaveTextContent("Could not be delivered via Teams chat");
    // The rows already say it on Past, so the alert drops its action there.
    expect(
      screen.queryByRole("button", { name: "Show in Past" }),
    ).not.toBeInTheDocument();
  });

  it("cancels an item only after the confirmation", async () => {
    const props = renderView();
    const name = "Send the revised packing list for container 4711";

    fireEvent.click(
      screen.getByRole("button", { name: `Actions for ${name}` }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Cancel" }));
    expect(props.onCancel).not.toHaveBeenCalled();

    const confirm = await screen.findByRole("button", {
      name: "Confirm action",
    });
    expect(confirm).toHaveTextContent("Cancel it");
    fireEvent.click(confirm);

    expect(props.onCancel).toHaveBeenCalledWith(
      expect.objectContaining({ name }),
    );
  });
});
