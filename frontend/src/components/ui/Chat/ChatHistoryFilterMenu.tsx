import { t } from "@lingui/core/macro";
import clsx from "clsx";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  hasActiveFilters,
  sanitizeChatHistoryFilters,
  useChatHistoryFilterStore,
} from "@/hooks/chat/store/chatHistoryFilterStore";
import { useRovingMenuFocus } from "@/hooks/ui/useRovingMenuFocus";
import {
  observePopoverViewport,
  resolvePopoverViewport,
} from "@/lib/popoverViewport";
import {
  applyFilterMenuChoice,
  describeFilterMenu,
  filterMenuChoice,
} from "@/lib/shell/menus/describeFilterMenu";
import { useSystemMenu } from "@/lib/shell/systemMenus/useSystemMenu";

import { AnchoredPopover } from "../Controls/AnchoredPopover";
import { Button } from "../Controls/Button";
import {
  PopoverChrome,
  PopoverPanel,
  PopoverSectionHeader,
  PopoverSeparator,
} from "../Controls/PopoverPanel";
import { Row } from "../Controls/Row";
import { CheckIcon, ChevronRightIcon, FilterSortIcon } from "../icons";

import type {
  ChatHistoryFilterStoreHook,
  ChatHistorySource,
} from "@/hooks/chat/store/chatHistoryFilterStore";
import type { FilterMenuRowKey } from "@/lib/shell/menus/describeFilterMenu";
import type { MenuEntry } from "@/lib/shell/menus/menuEntry";
import type React from "react";

export interface ChatHistoryFilterMenuProps {
  /** Shows the assistant-scoped entries (Type row, group-by-Type option). */
  assistantsEnabled: boolean;
  /**
   * Shows the "Delegated runs" row. Composes with `assistantsEnabled`: a
   * deployment without assistants has no delegation either.
   */
  delegationEnabled: boolean;
  /**
   * Sources chats can come from in this deployment. The "Source" row shows
   * only when one of them is an integration (anything besides the web app and
   * older chats).
   */
  availableSources?: readonly ChatHistorySource[];
  className?: string;
  /**
   * Filter store instance the menu reads and writes. Defaults to the web
   * sidebar's singleton; surfaces with their own persistence (the add-in
   * drawer) pass their own. Must stay the same instance for the component's
   * lifetime.
   */
  store?: ChatHistoryFilterStoreHook;
}

type SubmenuKey = FilterMenuRowKey;

const SUBMENU_KEYS: readonly string[] = [
  "type",
  "status",
  "delegated",
  "source",
  // eslint-disable-next-line lingui/no-unlocalized-strings -- submenu key, not user-facing
  "groupBy",
];

interface SubmenuOption {
  id: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}

interface SubmenuRow {
  key: SubmenuKey;
  label: string;
  valueLabel: string;
  /** Single-choice options; each `onSelect` decides whether the menu closes. */
  options: SubmenuOption[];
  /**
   * Multi-choice options listed under a header below `options`. Toggling one
   * keeps the menu open, so several can be flipped in one pass.
   */
  checkboxGroup?: { label: string; options: SubmenuOption[] };
}

const EMPTY_SOURCES: readonly ChatHistorySource[] = [];

// Navigable rows for roving focus: the top-level rows while no flyout is open,
// only the flyout's options while one is — so ArrowUp/Down never jump between
// the two levels. This menu therefore keeps its own two keyed markers rather
// than navigating by the row marker every `Row` carries, which cannot tell the
// levels apart.
const ROW_SELECTOR = "[data-filter-menu-row]";
const OPTION_SELECTOR = "[data-filter-menu-option]";

const SUBMENU_HOVER_DELAY_MS = 150;
// The flyout overlaps the parent panel so the pointer never crosses a gap on
// its way in (a gap would fire the row's pointerleave and close the flyout).
const SUBMENU_OVERLAP_PX = 4;
// Same delayed close as DropdownMenu's item click, so a selection stays
// visible for a beat (checkmark moves) before the menu dismisses.
const CLOSE_ON_SELECT_DELAY_MS = 100;

function submenuRowFromEntry(
  entry: MenuEntry,
  choose: (entry: MenuEntry) => void,
): SubmenuRow {
  const option = (child: MenuEntry): SubmenuOption => {
    const choice = filterMenuChoice(child.id);
    return {
      id: choice && "value" in choice ? choice.value : child.id,
      label: child.label ?? "",
      selected: child.state === "on",
      disabled: child.disabled,
      onSelect: () => choose(child),
    };
  };
  const children = entry.children ?? [];
  const single =
    entry.selection === "single"
      ? children
      : (children.find((child) => child.selection === "single")?.children ??
        []);
  const multiple = children.find((child) => child.selection === "multiple");
  return {
    key: entry.id as SubmenuKey,
    label: entry.label ?? "",
    valueLabel: entry.subtitle ?? "",
    options: single.map(option),
    ...(multiple
      ? {
          checkboxGroup: {
            label: multiple.label ?? "",
            options: (multiple.children ?? []).map(option),
          },
        }
      : {}),
  };
}

/**
 * Filter/sort menu for the sidebar chat list: a sliders trigger opening a
 * small menu of submenu rows (Type / Status / Group by) plus a reset action.
 * Each row's flyout is rendered inside the same popover panel — a nested
 * `AnchoredPopover` would count as "outside" for the parent's dismiss handler
 * and close it — absolutely positioned next to its anchor row.
 */
export function ChatHistoryFilterMenu({
  assistantsEnabled,
  delegationEnabled,
  availableSources = EMPTY_SOURCES,
  className,
  store = useChatHistoryFilterStore,
}: ChatHistoryFilterMenuProps) {
  const checkboxGroupHeaderId = useId();
  const [isOpen, setIsOpenState] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState<SubmenuKey | null>(null);
  const [submenuTop, setSubmenuTop] = useState(0);
  const [submenuSide, setSubmenuSide] = useState<"right" | "left">("right");
  // Panel-relative, so the flyout stays inside the screen's usable area.
  const [submenuBounds, setSubmenuBounds] = useState<{
    minTop: number;
    maxTop: number;
    maxHeight: number;
  } | null>(null);
  // The flyout shifts up by its own top padding so its first option aligns
  // with the anchor row; measured (before paint) because that padding is the
  // themable dropdown chrome token, not a constant.
  const [submenuPadTop, setSubmenuPadTop] = useState(0);

  const panelRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const submenuScrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Partial<Record<SubmenuKey, HTMLElement | null>>>({});
  const hoverOpenTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const selectCloseTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const focusSubmenuOnOpenRef = useRef(false);
  // A click on the row of a hover-opened flyout must keep it open (the usual
  // "hover, read, then click" gesture), not toggle it away.
  const submenuOpenedByHoverRef = useRef(false);

  const typeFilter = store((state) => state.typeFilter);
  const statusFilter = store((state) => state.statusFilter);
  const delegatedFilter = store((state) => state.delegatedFilter);
  const groupBy = store((state) => state.groupBy);
  const sourceFilter = store((state) => state.sourceFilter);
  const setTypeFilter = store((state) => state.setTypeFilter);
  const setStatusFilter = store((state) => state.setStatusFilter);
  const setDelegatedFilter = store((state) => state.setDelegatedFilter);
  const setGroupBy = store((state) => state.setGroupBy);
  const setSourceMode = store((state) => state.setSourceMode);
  const toggleSource = store((state) => state.toggleSource);
  const resetToDefaults = store((state) => state.resetToDefaults);

  const filterValues = {
    typeFilter,
    statusFilter,
    delegatedFilter,
    groupBy,
    sourceFilter,
  };
  const filterCapabilities = {
    assistantsEnabled,
    delegationEnabled,
    availableSources,
  };
  const filters = sanitizeChatHistoryFilters(filterValues, filterCapabilities);

  const clearHoverTimers = useCallback(() => {
    clearTimeout(hoverOpenTimerRef.current);
    clearTimeout(hoverCloseTimerRef.current);
  }, []);

  const setIsOpen = useCallback(
    (open: boolean) => {
      setIsOpenState(open);
      if (!open) {
        clearHoverTimers();
        setOpenSubmenu(null);
      }
    },
    [clearHoverTimers],
  );

  const openSubmenuFor = useCallback(
    (key: SubmenuKey, { focusOptions = false } = {}) => {
      clearHoverTimers();
      submenuOpenedByHoverRef.current = false;
      focusSubmenuOnOpenRef.current = focusOptions;
      const rowElement = rowRefs.current[key];
      setSubmenuTop(rowElement ? rowElement.offsetTop : 0);
      setOpenSubmenu(key);
    },
    [clearHoverTimers],
  );

  const closeSubmenu = useCallback(() => {
    clearHoverTimers();
    submenuOpenedByHoverRef.current = false;
    setOpenSubmenu(null);
  }, [clearHoverTimers]);

  const scheduleSubmenuOpen = useCallback(
    (key: SubmenuKey) => {
      clearHoverTimers();
      hoverOpenTimerRef.current = setTimeout(() => {
        openSubmenuFor(key);
        submenuOpenedByHoverRef.current = true;
      }, SUBMENU_HOVER_DELAY_MS);
    },
    [clearHoverTimers, openSubmenuFor],
  );

  const scheduleSubmenuClose = useCallback(() => {
    clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = setTimeout(
      () => setOpenSubmenu(null),
      SUBMENU_HOVER_DELAY_MS,
    );
  }, []);

  const cancelSubmenuClose = useCallback(() => {
    clearTimeout(hoverCloseTimerRef.current);
  }, []);

  // Leaving a flyout row (or entering a row without one) retires any pending
  // open and closes the flyout after the grace delay — long enough to travel
  // into the flyout itself, whose pointerenter cancels the close.
  const handleSubmenuHoverAway = useCallback(() => {
    clearTimeout(hoverOpenTimerRef.current);
    scheduleSubmenuClose();
  }, [scheduleSubmenuClose]);

  useEffect(
    () => () => {
      clearHoverTimers();
      clearTimeout(selectCloseTimerRef.current);
    },
    [clearHoverTimers],
  );

  useRovingMenuFocus({
    containerRef: panelRef,
    enabled: isOpen,
    itemSelector: openSubmenu ? OPTION_SELECTOR : ROW_SELECTOR,
  });

  // Flip the flyout to the left when it would overrun the usable area's
  // right edge, and keep it between that area's top and bottom.
  const placeSubmenu = useCallback(() => {
    const panelElement = panelRef.current;
    const submenuElement = submenuRef.current;
    if (!panelElement || !submenuElement) {
      return;
    }

    const viewport = resolvePopoverViewport(
      "var(--theme-layout-dropdown-viewport-margin)",
      panelElement,
    );
    const panelRect = panelElement.getBoundingClientRect();
    setSubmenuPadTop(
      Number.parseFloat(window.getComputedStyle(submenuElement).paddingTop) ||
        0,
    );
    const submenuWidth = submenuElement.offsetWidth;
    const overflowsRight =
      panelRect.right - SUBMENU_OVERLAP_PX + submenuWidth > viewport.right;
    const fitsLeft =
      panelRect.left + SUBMENU_OVERLAP_PX - submenuWidth >= viewport.left;
    setSubmenuSide(overflowsRight && fitsLeft ? "left" : "right");

    // Its whole height, also while a shorter area caps and scrolls it.
    const scroller = submenuScrollRef.current;
    const fullHeight =
      submenuElement.offsetHeight +
      (scroller ? scroller.scrollHeight - scroller.clientHeight : 0);
    setSubmenuBounds({
      minTop: viewport.top - panelRect.top,
      maxTop: viewport.bottom - panelRect.top - fullHeight,
      maxHeight: Math.max(0, viewport.bottom - viewport.top),
    });
  }, []);

  // Before paint, and again when the keyboard or a rotation moves the edges;
  // a keyboard open focuses the selected option.
  useLayoutEffect(() => {
    if (!openSubmenu) {
      return;
    }
    placeSubmenu();

    if (focusSubmenuOnOpenRef.current) {
      focusSubmenuOnOpenRef.current = false;
      const submenuElement = submenuRef.current;
      const focusTarget =
        submenuElement?.querySelector<HTMLElement>('[aria-checked="true"]') ??
        submenuElement?.querySelector<HTMLElement>(OPTION_SELECTOR);
      focusTarget?.focus();
    }

    // After the panel's own move, which was asked for first.
    return observePopoverViewport(() => requestAnimationFrame(placeSubmenu));
  }, [openSubmenu, placeSubmenu]);

  const applyAndClose = useCallback(
    (apply: () => void) => {
      apply();
      clearTimeout(selectCloseTimerRef.current);
      selectCloseTimerRef.current = setTimeout(
        () => setIsOpen(false),
        CLOSE_ON_SELECT_DELAY_MS,
      );
    },
    [setIsOpen],
  );

  const handlePanelKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowRight") {
        const rowElement = (event.target as HTMLElement).closest<HTMLElement>(
          ROW_SELECTOR,
        );
        const key = rowElement?.dataset.filterMenuRow;
        if (key && SUBMENU_KEYS.includes(key)) {
          event.preventDefault();
          event.stopPropagation();
          openSubmenuFor(key as SubmenuKey, { focusOptions: true });
        }
        return;
      }
      if (
        (event.key === "ArrowLeft" || event.key === "Escape") &&
        openSubmenu
      ) {
        event.preventDefault();
        // For Escape this also halts the native event at React's delegation
        // root (the portal container), so AnchoredPopover's document-level
        // Escape listener never fires and the menu itself stays open.
        event.stopPropagation();
        const rowElement = rowRefs.current[openSubmenu];
        closeSubmenu();
        rowElement?.focus();
      }
    },
    [closeSubmenu, openSubmenu, openSubmenuFor],
  );

  const setters = {
    setTypeFilter,
    setStatusFilter,
    setDelegatedFilter,
    setGroupBy,
    setSourceMode,
    toggleSource,
    resetToDefaults,
  };
  const choose = (entry: MenuEntry) => {
    const choice = filterMenuChoice(entry.id);
    if (!choice) return;
    if (entry.keepOpen) {
      applyFilterMenuChoice(choice, setters);
    } else {
      applyAndClose(() => applyFilterMenuChoice(choice, setters));
    }
  };
  const description = describeFilterMenu(filterValues, filterCapabilities);
  const applyPick = (itemId: string, on = true) => {
    const choice = filterMenuChoice(itemId);
    if (!choice) return;
    // A source flips; act only when it is not already as asked.
    const ticked =
      choice.kind === "source" &&
      filters.sourceFilter.sources.includes(choice.value);
    if (choice.kind === "source" && ticked === on) return;
    applyFilterMenuChoice(choice, setters);
  };
  const nativeMenu = useSystemMenu({
    id: "chat-history-filter",
    mode: "show",
    entries: description,
    onChoose: applyPick,
    onToggle: applyPick,
  });
  const sections = description.map((section) => section.children ?? []);
  const rowsByKey: Partial<Record<SubmenuKey, SubmenuRow>> = Object.fromEntries(
    sections
      .flat()
      .filter((entry) => entry.children)
      .map((entry) => [entry.id, submenuRowFromEntry(entry, choose)]),
  );
  const activeRow = openSubmenu ? (rowsByKey[openSubmenu] ?? null) : null;

  const renderSubmenuRow = (row: SubmenuRow) => (
    <Row
      key={row.key}
      variant="menu"
      ref={(element) => {
        rowRefs.current[row.key] = element;
      }}
      role="menuitem"
      aria-haspopup="menu"
      // Row keeps an expanded row lit for as long as its flyout is up.
      expanded={openSubmenu === row.key}
      tabIndex={-1}
      data-filter-menu-row={row.key}
      data-testid={`chat-history-filter-menu-row-${row.key}`}
      onClick={() => {
        if (openSubmenu !== row.key) {
          openSubmenuFor(row.key);
        } else if (submenuOpenedByHoverRef.current) {
          // First click after a hover-open just confirms it; the next one
          // toggles closed.
          submenuOpenedByHoverRef.current = false;
        } else {
          closeSubmenu();
        }
      }}
      onPointerEnter={() => scheduleSubmenuOpen(row.key)}
      onPointerLeave={handleSubmenuHoverAway}
      trailing={
        <ChevronRightIcon className="size-3 shrink-0 text-theme-fg-muted" />
      }
    >
      <span className="min-w-0 flex-1 truncate">{row.label}</span>
      <span className="min-w-0 max-w-48 shrink truncate text-xs text-theme-fg-muted">
        {row.valueLabel}
      </span>
    </Row>
  );

  const renderOption = (
    rowKey: SubmenuKey,
    option: SubmenuOption,
    role: "menuitemradio" | "menuitemcheckbox",
  ) => (
    <Row
      key={option.id}
      variant="menu"
      role={role}
      checked={option.selected}
      disabled={option.disabled}
      disabledMode="aria"
      tabIndex={-1}
      data-filter-menu-option=""
      data-testid={`chat-history-filter-menu-option-${rowKey}-${option.id}`}
      onClick={option.disabled ? undefined : option.onSelect}
      trailing={
        <CheckIcon
          className={clsx(
            "size-4 shrink-0 text-theme-fg-primary",
            option.selected ? "opacity-100" : "opacity-0",
          )}
        />
      }
    >
      <span className="min-w-0 flex-1 truncate">{option.label}</span>
    </Row>
  );

  return (
    <AnchoredPopover
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      nativeMenu={nativeMenu}
      panelRef={panelRef}
      role="menu"
      ariaHasPopup="menu"
      preferredOrientation={{ vertical: "bottom", horizontal: "right" }}
      initialFocusSelector={ROW_SELECTOR}
      width="min"
      dataUi="chat-history-filter-menu"
      trigger={(triggerProps) => (
        <Button
          {...triggerProps}
          variant="sidebar-icon"
          size="sm"
          aria-label={t({
            id: "chat.history.filterMenu.trigger",
            message: "Filter and sort chats",
          })}
          data-testid="chat-history-filter-menu-trigger"
          className={clsx(
            "relative",
            isOpen &&
              "bg-[var(--theme-shell-sidebar-hover)] text-theme-fg-primary",
            className,
          )}
          icon={<FilterSortIcon className="size-4" />}
        >
          {hasActiveFilters(filters) && (
            <span
              aria-hidden="true"
              data-testid="chat-history-filter-menu-active-indicator"
              className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-theme-action-primary-bg"
            />
          )}
        </Button>
      )}
    >
      {/* Single wrapper around rows AND flyout so keydown from either bubbles
          here; it stays unpositioned so the flyout's absolute coordinates
          resolve against the popover panel, matching the rows' offsetTop. It
          also must not scroll: offsetTop ignores an ancestor's scrollTop, so
          scrolled rows would drift away from the flyout anchored to them. */}
      <PopoverChrome
        scroll={false}
        onKeyDown={handlePanelKeyDown}
        dataUi="chat-history-filter-menu-content"
      >
        {sections.map((entries, index) => (
          <Fragment key={index}>
            {index > 0 && <PopoverSeparator />}
            {entries.map((entry) => {
              const row = rowsByKey[entry.id as SubmenuKey];
              if (row) return renderSubmenuRow(row);
              return (
                <Row
                  key={entry.id}
                  variant="menu"
                  role="menuitem"
                  tabIndex={-1}
                  data-filter-menu-row={entry.id}
                  data-testid={`chat-history-filter-menu-${entry.id}`}
                  onClick={() => choose(entry)}
                  onPointerEnter={handleSubmenuHoverAway}
                >
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                </Row>
              );
            })}
          </Fragment>
        ))}

        {activeRow && (
          <PopoverPanel
            ref={submenuRef}
            positioned="absolute"
            width="content"
            padded
            role="menu"
            aria-label={activeRow.label}
            data-testid="chat-history-filter-menu-submenu"
            dataUi="chat-history-filter-menu-submenu"
            className="z-10 flex flex-col"
            style={{
              // The top bound wins when the area is shorter than the flyout,
              // whose rows then scroll.
              top: Math.max(
                submenuBounds?.minTop ?? Number.MIN_SAFE_INTEGER,
                Math.min(
                  Math.max(0, submenuTop - submenuPadTop),
                  submenuBounds?.maxTop ?? Number.MAX_SAFE_INTEGER,
                ),
              ),
              maxHeight: submenuBounds?.maxHeight,
              ...(submenuSide === "right"
                ? { left: `calc(100% - ${SUBMENU_OVERLAP_PX}px)` }
                : { right: `calc(100% - ${SUBMENU_OVERLAP_PX}px)` }),
            }}
            onPointerEnter={cancelSubmenuClose}
            onPointerLeave={scheduleSubmenuClose}
          >
            {/* The rows scroll inside the panel: scrolling the panel itself
                would carry the glass fill (its ::before) away with them. */}
            <div
              ref={submenuScrollRef}
              className="flex min-h-0 flex-col overflow-y-auto overscroll-contain"
            >
              {activeRow.options.map((option) =>
                renderOption(activeRow.key, option, "menuitemradio"),
              )}
              {activeRow.checkboxGroup && (
                <>
                  <PopoverSeparator />
                  <div
                    role="group"
                    aria-labelledby={checkboxGroupHeaderId}
                    className="flex flex-col"
                  >
                    <PopoverSectionHeader id={checkboxGroupHeaderId}>
                      {activeRow.checkboxGroup.label}
                    </PopoverSectionHeader>
                    {activeRow.checkboxGroup.options.map((option) =>
                      renderOption(activeRow.key, option, "menuitemcheckbox"),
                    )}
                  </div>
                </>
              )}
            </div>
          </PopoverPanel>
        )}
      </PopoverChrome>
    </AnchoredPopover>
  );
}
