import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { ScheduledItemForm } from "../ScheduledItemForm";
import { emptyScheduledFormValues } from "../scheduledForm";

import type { ScheduledItemFormProps } from "../ScheduledItemForm";
import type { Messages } from "@lingui/core";

vi.mock("@/hooks/ui/useThemedIcon", () => ({
  useThemedIcon: () => null,
}));

// Saturday, 7 November 2026, 12:00 in Berlin.
const NOW = new Date("2026-11-07T11:00:00Z");
const ZONE = "Europe/Berlin";

const renderForm = (overrides: Partial<ScheduledItemFormProps> = {}) => {
  const props: ScheduledItemFormProps = {
    mode: "create",
    initialValues: emptyScheduledFormValues(NOW, ZONE),
    channelStatus: "connected",
    chats: [
      { id: "chat-1", title: "Offer Müller GmbH" },
      { id: "chat-2", title: "Q4 rate comparison" },
    ],
    now: NOW,
    timeZone: ZONE,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(
    <I18nProvider i18n={i18n}>
      <ScheduledItemForm {...props} />
    </I18nProvider>,
  );
  return props;
};

describe("ScheduledItemForm", () => {
  beforeEach(() => {
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  it("schedules a one-off reminder with the values entered", () => {
    const props = renderForm();

    fireEvent.change(screen.getByRole("textbox", { name: /Name/ }), {
      target: { value: "Call Ms Schulz back" },
    });
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-11-13" },
    });
    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: "10:00" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Message/ }), {
      target: { value: "About the delivery date." },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Linked chat" }), {
      target: { value: "chat-2" },
    });

    expect(screen.getByTestId("scheduled-trigger-summary")).toHaveTextContent(
      "Happens on Friday, November 13, 2026, 10:00 AM, in 6 days.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Schedule reminder" }));

    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Call Ms Schulz back",
        message: "About the delivery date.",
        triggerKind: "once",
        date: "2026-11-13",
        time: "10:00",
        linkedChatId: "chat-2",
        channel: "teams_chat",
      }),
    );
  });

  it("shows what is missing instead of submitting", () => {
    const props = renderForm({
      initialValues: {
        ...emptyScheduledFormValues(NOW, ZONE),
        date: "2026-11-07",
        time: "08:00",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Schedule reminder" }));

    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a name.")).toBeInTheDocument();
    expect(
      screen.getByText("Enter the message Erato sends you."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This time is in the past. Pick a time in the future."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("builds a weekly schedule from the repeating fields", () => {
    const props = renderForm({
      initialValues: {
        ...emptyScheduledFormValues(NOW, ZONE),
        name: "Weekly check",
        message: "Check the open offers.",
      },
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Trigger" }), {
      target: { value: "repeat" },
    });
    expect(screen.queryByLabelText("Date")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Repeats" }), {
      target: { value: "weekly" },
    });
    const days = screen.getByRole("group", { name: "On these days" });
    fireEvent.click(within(days).getByRole("checkbox", { name: "Monday" }));
    fireEvent.change(screen.getByLabelText("Starts"), {
      target: { value: "2026-11-09" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Ends" }), {
      target: { value: "after_count" },
    });
    fireEvent.change(screen.getByLabelText("Number of times"), {
      target: { value: "4" },
    });

    expect(screen.getByTestId("scheduled-trigger-summary")).toHaveTextContent(
      "Happens every week on Monday and Sunday at 09:00 AM, first on Monday, November 9, 2026. 4 times in all.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Schedule reminder" }));
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerKind: "repeat",
        frequency: "weekly",
        weekdays: ["sun", "mon"],
        date: "2026-11-09",
        endKind: "after_count",
        endCount: "4",
      }),
    );
  });

  it("names the channel only in the delivery settings, with its state", () => {
    renderForm({ channelStatus: "not_set_up" });

    const toggle = screen.getByRole("button", { name: "Advanced settings" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByText("Deliver via Teams chat").parentElement,
    ).toHaveTextContent("Not set up");

    fireEvent.click(toggle);
    expect(screen.getByRole("radio", { name: /Teams chat/ })).toBeChecked();
    expect(
      screen.getByText(/Erato can't reach you in Teams yet/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Desktop notification/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("radio", { name: /Browser notification/ }),
    ).toBeDisabled();
  });

  it("opens the delivery settings on a refused channel", () => {
    renderForm({
      serverErrors: { channel: "Set it up first." },
      channelStatus: "not_set_up",
    });

    expect(
      screen.getByRole("button", { name: "Advanced settings" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Set it up first.");
  });

  it("shows a form-wide refusal next to the buttons and saves on edit", () => {
    const props = renderForm({
      mode: "edit",
      formError: "You have the maximum number of upcoming items.",
      initialValues: {
        ...emptyScheduledFormValues(NOW, ZONE),
        name: "Existing",
        message: "Body",
      },
    });

    expect(screen.getByTestId("scheduled-form-error")).toHaveTextContent(
      "You have the maximum number of upcoming items.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(props.onSubmit).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalled();
  });

  it("saves an edit of a snoozed item whose trigger time is already over", () => {
    const props = renderForm({
      mode: "edit",
      initialValues: {
        ...emptyScheduledFormValues(NOW, ZONE),
        name: "Call back Hafen Logistik",
        message: "Body",
        date: "2026-11-01",
        time: "10:00",
      },
    });

    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), {
      target: { value: "Call back Hafen Logistik today" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Call back Hafen Logistik today" }),
    );
  });
});
