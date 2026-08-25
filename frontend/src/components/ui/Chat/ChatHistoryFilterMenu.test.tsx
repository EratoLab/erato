import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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

  function renderMenu(assistantsEnabled = true, delegationEnabled = true) {
    return render(
      <I18nProvider i18n={i18n}>
        <ChatHistoryFilterMenu
          assistantsEnabled={assistantsEnabled}
          delegationEnabled={delegationEnabled}
        />
      </I18nProvider>,
    );
  }

  function openMenu() {
    fireEvent.click(screen.getByTestId("chat-history-filter-menu-trigger"));
  }

  // Selecting closes after the same short delay DropdownMenu uses; flush it.
  function flushCloseDelay() {
    act(() => {
      vi.advanceTimersByTime(100);
    });
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

  it("offers the delegated-runs row only while delegation is on", () => {
    renderMenu(true, false);
    openMenu();
    expect(
      screen.queryByTestId("chat-history-filter-menu-row-delegated"),
    ).not.toBeInTheDocument();

    cleanup();
    renderMenu(true, true);
    openMenu();
    expect(
      screen.getByTestId("chat-history-filter-menu-row-delegated"),
    ).toHaveTextContent("Hidden");
  });

  it("hides the delegated-runs row when assistants are off entirely", () => {
    // Delegation implies assistants; the row must not outlive them.
    renderMenu(false, true);
    openMenu();

    expect(
      screen.queryByTestId("chat-history-filter-menu-row-delegated"),
    ).not.toBeInTheDocument();
  });

  it("writes the delegated facet to the store without touching the type", () => {
    vi.useFakeTimers();
    try {
      useChatHistoryFilterStore.getState().setTypeFilter("assistant");
      renderMenu();
      openMenu();
      fireEvent.click(
        screen.getByTestId("chat-history-filter-menu-row-delegated"),
      );
      fireEvent.click(
        screen.getByTestId("chat-history-filter-menu-option-delegated-shown"),
      );

      const state = useChatHistoryFilterStore.getState();
      expect(state.delegatedFilter).toBe("shown");
      expect(state.typeFilter).toBe("assistant");
      flushCloseDelay();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the trigger expanded while open", () => {
    renderMenu();
    const trigger = screen.getByTestId("chat-history-filter-menu-trigger");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    openMenu();

    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("applies a submenu option to the store and closes the whole menu", () => {
    vi.useFakeTimers();
    try {
      renderMenu();
      openMenu();
      fireEvent.click(
        screen.getByTestId("chat-history-filter-menu-row-status"),
      );

      const option = screen.getByTestId(
        "chat-history-filter-menu-option-status-all",
      );
      expect(option).toHaveAttribute("role", "menuitemradio");
      expect(option).toHaveAttribute("aria-checked", "false");

      fireEvent.click(option);

      expect(useChatHistoryFilterStore.getState().statusFilter).toBe("all");
      flushCloseDelay();
      expect(
        screen.queryByTestId("chat-history-filter-menu-row-status"),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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

  it("closes only the flyout on Escape, then the menu on a second Escape", () => {
    renderMenu();
    openMenu();
    const row = screen.getByTestId("chat-history-filter-menu-row-status");
    fireEvent.click(row);
    const option = screen.getByTestId(
      "chat-history-filter-menu-option-status-all",
    );

    fireEvent.keyDown(option, { key: "Escape" });

    expect(
      screen.queryByTestId("chat-history-filter-menu-submenu"),
    ).not.toBeInTheDocument();
    // The menu itself survived the first Escape and focus is back on the row.
    expect(
      screen.getByTestId("chat-history-filter-menu-row-status"),
    ).toBeInTheDocument();
    expect(row).toHaveFocus();

    fireEvent.keyDown(row, { key: "Escape" });

    expect(
      screen.queryByTestId("chat-history-filter-menu-row-status"),
    ).not.toBeInTheDocument();
  });

  it("shows the active-filters dot for type and status but never for grouping", () => {
    const defaults = renderMenu();
    expect(
      screen.queryByTestId("chat-history-filter-menu-active-indicator"),
    ).not.toBeInTheDocument();
    defaults.unmount();

    // Grouping is a view preference, not a filter, so it leaves the dot off.
    useChatHistoryFilterStore.getState().setGroupBy("none");
    const groupedOnly = renderMenu();
    expect(
      screen.queryByTestId("chat-history-filter-menu-active-indicator"),
    ).not.toBeInTheDocument();
    groupedOnly.unmount();

    useChatHistoryFilterStore.getState().resetToDefaults();
    useChatHistoryFilterStore.getState().setTypeFilter("chat");
    const typeOnly = renderMenu();
    expect(
      screen.getByTestId("chat-history-filter-menu-active-indicator"),
    ).toBeInTheDocument();
    typeOnly.unmount();

    useChatHistoryFilterStore.getState().resetToDefaults();
    useChatHistoryFilterStore.getState().setStatusFilter("all");
    renderMenu();

    expect(
      screen.getByTestId("chat-history-filter-menu-active-indicator"),
    ).toBeInTheDocument();
  });

  it("resets to defaults and closes", () => {
    vi.useFakeTimers();
    try {
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
      flushCloseDelay();
      expect(
        screen.queryByTestId("chat-history-filter-menu-reset"),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("derives panel and row styling from the shared dropdown theme channel", () => {
    renderMenu();
    openMenu();

    const panel = document.querySelector(
      '[data-ui="chat-history-filter-menu"]',
    );
    expect(panel).toHaveClass("anchored-popover-skin");
    expect(panel).toHaveClass("w-[var(--theme-layout-dropdown-min-width)]");
    expect(panel).toHaveStyle({
      minWidth: "var(--theme-layout-dropdown-min-width)",
    });

    const content = document.querySelector(
      '[data-ui="chat-history-filter-menu-content"]',
    );
    expect(content).toHaveClass("dropdown-panel-chrome-geometry");

    const row = screen.getByTestId("chat-history-filter-menu-row-status");
    expect(row).toHaveClass("dropdown-item-geometry");

    fireEvent.click(row);
    const submenu = screen.getByTestId("chat-history-filter-menu-submenu");
    expect(submenu).toHaveClass("anchored-popover-skin");
    expect(submenu).toHaveClass("dropdown-panel-chrome-geometry");
    expect(
      screen.getByTestId("chat-history-filter-menu-option-status-all"),
    ).toHaveClass("dropdown-item-geometry");
  });
});
