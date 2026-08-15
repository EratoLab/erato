import { t } from "@lingui/core/macro";
import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  isDefaultFilters,
  sanitizeChatHistoryFilters,
  useChatHistoryFilterStore,
} from "@/hooks/chat/store/chatHistoryFilterStore";
import { useRovingMenuFocus } from "@/hooks/ui/useRovingMenuFocus";

import { AnchoredPopover } from "../Controls/AnchoredPopover";
import { Button } from "../Controls/Button";
import { CheckIcon, ChevronRightIcon, FilterSortIcon } from "../icons";

import type {
  ChatHistoryGroupBy,
  ChatHistoryStatusFilter,
  ChatHistoryTypeFilter,
} from "@/hooks/chat/store/chatHistoryFilterStore";
import type React from "react";

export interface ChatHistoryFilterMenuProps {
  /** Shows the assistant-scoped entries (Type row, group-by-Type option). */
  assistantsEnabled: boolean;
  className?: string;
}

type SubmenuKey = "type" | "status" | "groupBy";

interface SubmenuOption {
  id: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}

interface SubmenuRow {
  key: SubmenuKey;
  label: string;
  valueLabel: string;
  options: SubmenuOption[];
}

// Navigable rows for roving focus: the top-level rows while no flyout is open,
// only the flyout's options while one is — so ArrowUp/Down never jump between
// the two levels.
const ROW_SELECTOR = "[data-filter-menu-row]";
const OPTION_SELECTOR = "[data-filter-menu-option]";

const SUBMENU_HOVER_DELAY_MS = 150;
// The flyout overlaps the parent panel so the pointer never crosses a gap on
// its way in (a gap would fire the row's pointerleave and close the flyout).
const SUBMENU_OVERLAP_PX = 4;
const VIEWPORT_PADDING_PX = 8;
// Same delayed close as DropdownMenu's item click, so a selection stays
// visible for a beat (checkmark moves) before the menu dismisses.
const CLOSE_ON_SELECT_DELAY_MS = 100;

const sectionDivider = "my-1 h-px bg-theme-border";

// Rows and flyout options share DropdownMenu's item channel — geometry class,
// typography and hover/focus colors — so customer themes retune every menu
// surface together.
const rowClassName =
  "dropdown-item-geometry theme-transition flex w-full items-center gap-2 rounded-[var(--theme-radius-control)] text-left text-sm text-theme-fg-secondary hover:bg-theme-bg-hover hover:text-theme-fg-primary focus:bg-theme-bg-hover focus:text-theme-fg-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-theme-border-dropdown";

function buildRow<V extends string>(
  key: SubmenuKey,
  label: string,
  options: { value: V; label: string }[],
  current: V,
  onSelect: (value: V) => void,
): SubmenuRow {
  const currentOption = options.find((option) => option.value === current);
  return {
    key,
    label,
    valueLabel: currentOption?.label ?? "",
    options: options.map((option) => ({
      id: option.value,
      label: option.label,
      selected: option.value === current,
      onSelect: () => onSelect(option.value),
    })),
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
  className,
}: ChatHistoryFilterMenuProps) {
  const [isOpen, setIsOpenState] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState<SubmenuKey | null>(null);
  const [submenuTop, setSubmenuTop] = useState(0);
  const [submenuSide, setSubmenuSide] = useState<"right" | "left">("right");
  const [submenuMaxTop, setSubmenuMaxTop] = useState<number | null>(null);
  // The flyout shifts up by its own top padding so its first option aligns
  // with the anchor row; measured (before paint) because that padding is the
  // themable dropdown chrome token, not a constant.
  const [submenuPadTop, setSubmenuPadTop] = useState(0);

  const panelRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Partial<Record<SubmenuKey, HTMLButtonElement | null>>>(
    {},
  );
  const hoverOpenTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const selectCloseTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const focusSubmenuOnOpenRef = useRef(false);
  // A click on the row of a hover-opened flyout must keep it open (the usual
  // "hover, read, then click" gesture), not toggle it away.
  const submenuOpenedByHoverRef = useRef(false);

  const typeFilter = useChatHistoryFilterStore((state) => state.typeFilter);
  const statusFilter = useChatHistoryFilterStore((state) => state.statusFilter);
  const groupBy = useChatHistoryFilterStore((state) => state.groupBy);
  const setTypeFilter = useChatHistoryFilterStore(
    (state) => state.setTypeFilter,
  );
  const setStatusFilter = useChatHistoryFilterStore(
    (state) => state.setStatusFilter,
  );
  const setGroupBy = useChatHistoryFilterStore((state) => state.setGroupBy);
  const resetToDefaults = useChatHistoryFilterStore(
    (state) => state.resetToDefaults,
  );

  const filters = sanitizeChatHistoryFilters(
    { typeFilter, statusFilter, groupBy },
    assistantsEnabled,
  );

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

  // Before paint: flip the flyout to the left when it would overrun the
  // viewport's right edge, cap its top so it cannot overrun the bottom, and
  // honor a keyboard open by focusing the selected option.
  useLayoutEffect(() => {
    if (!openSubmenu) {
      return;
    }
    const panelElement = panelRef.current;
    const submenuElement = submenuRef.current;
    if (!panelElement || !submenuElement) {
      return;
    }

    const panelRect = panelElement.getBoundingClientRect();
    setSubmenuPadTop(
      Number.parseFloat(window.getComputedStyle(submenuElement).paddingTop) ||
        0,
    );
    const submenuWidth = submenuElement.offsetWidth;
    const overflowsRight =
      panelRect.right - SUBMENU_OVERLAP_PX + submenuWidth >
      window.innerWidth - VIEWPORT_PADDING_PX;
    const fitsLeft =
      panelRect.left + SUBMENU_OVERLAP_PX - submenuWidth >= VIEWPORT_PADDING_PX;
    setSubmenuSide(overflowsRight && fitsLeft ? "left" : "right");

    // Panel-relative bounds keeping the flyout inside the viewport; the lower
    // bound wins when the viewport is shorter than the flyout.
    const submenuHeight = submenuElement.offsetHeight;
    setSubmenuMaxTop(
      Math.max(
        VIEWPORT_PADDING_PX - panelRect.top,
        window.innerHeight -
          VIEWPORT_PADDING_PX -
          panelRect.top -
          submenuHeight,
      ),
    );

    if (focusSubmenuOnOpenRef.current) {
      focusSubmenuOnOpenRef.current = false;
      const focusTarget =
        submenuElement.querySelector<HTMLElement>('[aria-checked="true"]') ??
        submenuElement.querySelector<HTMLElement>(OPTION_SELECTOR);
      focusTarget?.focus();
    }
  }, [openSubmenu]);

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
        if (key === "type" || key === "status" || key === "groupBy") {
          event.preventDefault();
          event.stopPropagation();
          openSubmenuFor(key, { focusOptions: true });
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

  const typeOptions: { value: ChatHistoryTypeFilter; label: string }[] = [
    {
      value: "all",
      label: t({ id: "chat.history.filterMenu.type.all", message: "All" }),
    },
    {
      value: "chat",
      label: t({ id: "chat.history.filterMenu.type.chat", message: "Chat" }),
    },
    {
      value: "assistant",
      label: t({
        id: "chat.history.filterMenu.type.assistant",
        message: "Assistant",
      }),
    },
  ];

  const statusOptions: { value: ChatHistoryStatusFilter; label: string }[] = [
    {
      value: "active",
      label: t({
        id: "chat.history.filterMenu.status.active",
        message: "Active",
      }),
    },
    {
      value: "all",
      label: t({ id: "chat.history.filterMenu.status.all", message: "All" }),
    },
  ];

  const groupByOptions: { value: ChatHistoryGroupBy; label: string }[] = [
    {
      value: "date",
      label: t({ id: "chat.history.filterMenu.groupBy.date", message: "Date" }),
    },
    ...(assistantsEnabled
      ? [
          {
            value: "type" as const,
            label: t({
              id: "chat.history.filterMenu.groupBy.type",
              message: "Type",
            }),
          },
        ]
      : []),
    {
      value: "unread",
      label: t({
        id: "chat.history.filterMenu.groupBy.unread",
        message: "Unread",
      }),
    },
    {
      value: "none",
      label: t({ id: "chat.history.filterMenu.groupBy.none", message: "None" }),
    },
  ];

  const typeRow = assistantsEnabled
    ? buildRow(
        "type",
        t({ id: "chat.history.filterMenu.type", message: "Type" }),
        typeOptions,
        filters.typeFilter,
        (value) => applyAndClose(() => setTypeFilter(value)),
      )
    : null;

  const statusRow = buildRow(
    "status",
    t({ id: "chat.history.filterMenu.status", message: "Status" }),
    statusOptions,
    filters.statusFilter,
    (value) => applyAndClose(() => setStatusFilter(value)),
  );

  const groupByRow = buildRow(
    // eslint-disable-next-line lingui/no-unlocalized-strings -- submenu key, not user-facing
    "groupBy",
    t({ id: "chat.history.filterMenu.groupBy", message: "Group by" }),
    groupByOptions,
    filters.groupBy,
    (value) => applyAndClose(() => setGroupBy(value)),
  );

  const rowsByKey: Record<SubmenuKey, SubmenuRow | null> = {
    type: typeRow,
    status: statusRow,
    groupBy: groupByRow,
  };
  const activeRow = openSubmenu ? rowsByKey[openSubmenu] : null;

  const renderSubmenuRow = (row: SubmenuRow) => (
    <button
      key={row.key}
      ref={(element) => {
        rowRefs.current[row.key] = element;
      }}
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={openSubmenu === row.key}
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
      className={clsx(
        rowClassName,
        openSubmenu === row.key && "bg-theme-bg-hover text-theme-fg-primary",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{row.label}</span>
      <span className="shrink-0 text-xs text-theme-fg-muted">
        {row.valueLabel}
      </span>
      <ChevronRightIcon className="size-3 shrink-0 text-theme-fg-muted" />
    </button>
  );

  return (
    <AnchoredPopover
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      panelRef={panelRef}
      role="menu"
      ariaHasPopup="menu"
      preferredOrientation={{ vertical: "bottom", horizontal: "right" }}
      initialFocusSelector={ROW_SELECTOR}
      panelStyle={{
        maxWidth:
          "calc(100vw - (var(--theme-layout-dropdown-viewport-margin) * 2))",
        minWidth: "var(--theme-layout-dropdown-min-width)",
      }}
      panelClassName="flex w-[var(--theme-layout-dropdown-min-width)] flex-col"
      viewportPadding="var(--theme-layout-dropdown-viewport-margin)"
      dataUi="chat-history-filter-menu"
      trigger={(triggerProps) => (
        <Button
          {...triggerProps}
          variant="icon-only"
          size="sm"
          aria-label={t({
            id: "chat.history.filterMenu.trigger",
            message: "Filter and sort chats",
          })}
          data-testid="chat-history-filter-menu-trigger"
          className={clsx(
            "relative",
            isOpen && "bg-theme-bg-hover text-theme-fg-primary",
            className,
          )}
          icon={<FilterSortIcon className="size-4" />}
        >
          {!isDefaultFilters(filters) && (
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
          resolve against the popover panel, matching the rows' offsetTop. */}
      <div
        className="dropdown-panel-chrome-geometry flex flex-col"
        role="none"
        onKeyDown={handlePanelKeyDown}
        data-ui="chat-history-filter-menu-content"
      >
        {typeRow && renderSubmenuRow(typeRow)}
        {renderSubmenuRow(statusRow)}
        <div className={sectionDivider} />
        {renderSubmenuRow(groupByRow)}
        <div className={sectionDivider} />
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          data-filter-menu-row="reset"
          data-testid="chat-history-filter-menu-reset"
          onClick={() => applyAndClose(resetToDefaults)}
          onPointerEnter={handleSubmenuHoverAway}
          className={rowClassName}
        >
          <span className="min-w-0 flex-1 truncate">
            {t({
              id: "chat.history.filterMenu.reset",
              message: "Reset to defaults",
            })}
          </span>
        </button>

        {activeRow && (
          <div
            ref={submenuRef}
            role="menu"
            aria-label={activeRow.label}
            data-testid="chat-history-filter-menu-submenu"
            data-ui="chat-history-filter-menu-submenu"
            className="anchored-popover-skin dropdown-panel-chrome-geometry theme-transition absolute z-10 w-max border"
            style={{
              top: Math.min(
                Math.max(0, submenuTop - submenuPadTop),
                submenuMaxTop ?? Number.MAX_SAFE_INTEGER,
              ),
              ...(submenuSide === "right"
                ? { left: `calc(100% - ${SUBMENU_OVERLAP_PX}px)` }
                : { right: `calc(100% - ${SUBMENU_OVERLAP_PX}px)` }),
            }}
            onPointerEnter={cancelSubmenuClose}
            onPointerLeave={scheduleSubmenuClose}
          >
            {activeRow.options.map((option) => (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={option.selected}
                tabIndex={-1}
                data-filter-menu-option=""
                data-testid={`chat-history-filter-menu-option-${activeRow.key}-${option.id}`}
                onClick={option.onSelect}
                className={rowClassName}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <CheckIcon
                  className={clsx(
                    "size-4 shrink-0 text-theme-fg-primary",
                    option.selected ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </AnchoredPopover>
  );
}
