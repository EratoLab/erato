import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChatHistoryFilterStore } from "@/hooks/chat/store/chatHistoryFilterStore";
import { messages as enMessages } from "@/locales/en/messages.json";

import { ChatHistoryFilterMenu } from "./ChatHistoryFilterMenu";

import type { Messages } from "@lingui/core";

describe("ChatHistoryFilterMenu", () => {
  beforeEach(() => {
    localStorage.clear();
    i18n.load("en", { ...(enMessages as unknown as Messages) });
    i18n.activate("en");
    useChatHistoryFilterStore.getState().resetToDefaults();
  });

  function renderMenu(assistantsEnabled = true) {
    return render(
      <I18nProvider i18n={i18n}>
        <ChatHistoryFilterMenu assistantsEnabled={assistantsEnabled} />
      </I18nProvider>,
    );
  }

  function openMenu() {
    fireEvent.click(screen.getByTestId("chat-history-filter-menu-trigger"));
  }

  it("opens from the trigger and shows the current value on each row", () => {
    renderMenu();
    openMenu();

    expect(
      screen.getByTestId("chat-history-filter-menu-row-type"),
    ).toHaveTextContent("All");
    expect(
      screen.getByTestId("chat-history-filter-menu-row-status"),
    ).toHaveTextContent("Active");
    expect(
      screen.getByTestId("chat-history-filter-menu-row-groupBy"),
    ).toHaveTextContent("Date");
    expect(
      screen.getByTestId("chat-history-filter-menu-reset"),
    ).toBeInTheDocument();
  });

  it("marks the trigger expanded while open", () => {
    renderMenu();
    const trigger = screen.getByTestId("chat-history-filter-menu-trigger");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    openMenu();

    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("applies a submenu option to the store and closes the whole menu", () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByTestId("chat-history-filter-menu-row-status"));

    const option = screen.getByTestId(
      "chat-history-filter-menu-option-status-all",
    );
    expect(option).toHaveAttribute("role", "menuitemradio");
    expect(option).toHaveAttribute("aria-checked", "false");

    fireEvent.click(option);

    expect(useChatHistoryFilterStore.getState().statusFilter).toBe("all");
    expect(
      screen.queryByTestId("chat-history-filter-menu-row-status"),
    ).not.toBeInTheDocument();
  });

  it("checks the currently selected option in the submenu", () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByTestId("chat-history-filter-menu-row-groupBy"));

    expect(
      screen.getByTestId("chat-history-filter-menu-option-groupBy-date"),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByTestId("chat-history-filter-menu-option-groupBy-none"),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("hides assistant-scoped entries when assistants are disabled", () => {
    renderMenu(false);
    openMenu();

    expect(
      screen.queryByTestId("chat-history-filter-menu-row-type"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("chat-history-filter-menu-row-groupBy"));

    expect(
      screen.queryByTestId("chat-history-filter-menu-option-groupBy-type"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("chat-history-filter-menu-option-groupBy-date"),
    ).toBeInTheDocument();
  });

  it("shows sanitized values while assistants are disabled", () => {
    useChatHistoryFilterStore.getState().setGroupBy("type");
    renderMenu(false);
    openMenu();

    expect(
      screen.getByTestId("chat-history-filter-menu-row-groupBy"),
    ).toHaveTextContent("Date");
  });

  it("keeps a hover-opened flyout open when its row is clicked", () => {
    vi.useFakeTimers();
    try {
      renderMenu();
      openMenu();
      const row = screen.getByTestId("chat-history-filter-menu-row-status");
      fireEvent.pointerEnter(row);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(
        screen.getByTestId("chat-history-filter-menu-submenu"),
      ).toBeInTheDocument();

      // The usual gesture: hover to the row, read the flyout, then click.
      fireEvent.click(row);
      expect(
        screen.getByTestId("chat-history-filter-menu-submenu"),
      ).toBeInTheDocument();

      // A further click is an explicit toggle and closes the flyout.
      fireEvent.click(row);
      expect(
        screen.queryByTestId("chat-history-filter-menu-submenu"),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets to defaults and closes", () => {
    useChatHistoryFilterStore.getState().setStatusFilter("all");
    useChatHistoryFilterStore.getState().setGroupBy("none");
    renderMenu();
    openMenu();

    fireEvent.click(screen.getByTestId("chat-history-filter-menu-reset"));

    expect(useChatHistoryFilterStore.getState()).toMatchObject({
      typeFilter: "all",
      statusFilter: "active",
      groupBy: "date",
    });
    expect(
      screen.queryByTestId("chat-history-filter-menu-reset"),
    ).not.toBeInTheDocument();
  });
});
