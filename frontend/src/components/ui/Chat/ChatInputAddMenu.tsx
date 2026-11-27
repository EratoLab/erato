import { plural, t } from "@lingui/core/macro";
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

import { useRovingMenuFocus } from "@/hooks/ui/useRovingMenuFocus";

import { AnchoredPopover } from "../Controls/AnchoredPopover";
import { Button } from "../Controls/Button";
import { CountBadge } from "../Controls/CountBadge";
import {
  PopoverChrome,
  PopoverSectionHeader,
  PopoverSeparator,
} from "../Controls/PopoverPanel";
import { Row, ROW_ITEM_SELECTOR } from "../Controls/Row";
import { SpinnerIcon } from "../Feedback/SpinnerIcon";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
} from "../icons";

import type React from "react";

// The ring swaps into the same slot as a 20px PlusIcon, so it takes that
// diameter rather than the nearest size step.
const TRIGGER_RING_STYLE = {
  // eslint-disable-next-line lingui/no-unlocalized-strings
  "--spinner-size": "1.25rem",
} as React.CSSProperties;

/** Fields shared by every row in the "+" menu. */
export interface AddMenuItemBase {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
}

/**
 * A one-shot action in the "+" menu — uploading a file, picking a photo,
 * choosing a cloud source. Tapping it runs `onSelect` and closes the menu.
 */
export interface AddMenuActionItem extends AddMenuItemBase {
  /** Clamp to two lines when true; wrap when false. Defaults to one line. */
  truncateDescription?: boolean;
  /** Optional secondary line (e.g. file size, provider hint). */
  description?: React.ReactNode;
  /**
   * Skip the close delay. Required of any row that opens a dialog, so the menu
   * is gone before the dialog takes focus instead of lingering over it.
   */
  closesImmediately?: boolean;
  onSelect: () => void;
}

/**
 * A persistent toggle in the "+" menu — a tool/facet that stays selected.
 * Rendered with a checkmark; the menu stays open after toggling so several
 * can be flipped in one pass.
 */
export interface AddMenuToolItem extends AddMenuItemBase {
  checked: boolean;
  /**
   * One choice among its section's rows (a radio) rather than a toggle; the
   * menu closes after it, like after an action.
   */
  exclusive?: boolean;
  /** Optional secondary line explaining what the toggle changes. */
  description?: React.ReactNode;
  onToggle: () => void;
}

/** A row a host-contributed section may carry: a one-shot action or a toggle. */
export type AddMenuSectionItem = AddMenuActionItem | AddMenuToolItem;

export const isAddMenuToolItem = (
  item: AddMenuSectionItem,
): item is AddMenuToolItem => "onToggle" in item;

/**
 * A host-contributed group of action rows — e.g. the Outlook add-in's
 * "Email content" sources. The host supplies item data; the menu owns the
 * rendering, dividers, and close-on-select behavior so hosts don't replicate
 * styling or re-implement interaction.
 */
export interface AddMenuSection {
  id: string;
  /** Optional group label rendered above the items. */
  header?: React.ReactNode;
  items: AddMenuSectionItem[];
  /** Placement relative to the Tools group. Defaults to "aboveTools". */
  placement?: "aboveTools" | "belowTools";
  /**
   * Shows the section as one row, its header plus `summary` (e.g. the current
   * choice), that opens its items as a page of the same menu with a back row,
   * the way an iPhone menu opens a nested menu. For lists that would otherwise
   * outgrow the menu. Needs a `header`.
   */
  submenu?: { summary?: React.ReactNode };
}

export interface ChatInputAddMenuProps {
  /** File-source actions (Upload from Computer, Sharepoint, …). */
  fileSources?: AddMenuActionItem[];
  /** Selectable tools / facets, rendered with checkmarks. */
  tools?: AddMenuToolItem[];
  /**
   * Host-injected sections rendered with the menu's own row machinery — e.g.
   * the Outlook email-content sources. This is the seam that lets a host
   * contribute extra sources without replacing the whole menu.
   */
  extraSections?: AddMenuSection[];
  /**
   * Host-rendered content injected as its own section (between file sources and
   * tools). Unlike `extraSections` (static data), this is a render-prop so a
   * stateful host — e.g. the Outlook add-in's email-content accordion — can run
   * its own hooks and close the menu via the provided `close` callback.
   */
  extraContent?: (api: { close: () => void }) => React.ReactNode;
  /** Disable the whole trigger. */
  disabled?: boolean;
  /** Show a spinner in the trigger while files are uploading/linking. */
  isProcessing?: boolean;
  /**
   * How many tools are on, shown on the trigger where the composer has no
   * room for the tool chips.
   */
  selectedToolCount?: number;
  className?: string;
}

// Same delayed close as DropdownMenu's item click, so a selection stays
// visible for a beat before the menu dismisses.
const CLOSE_ON_SELECT_DELAY_MS = 100;

// CSS selector for the menu's navigable rows; natively-disabled rows are
// excluded from roving focus (aria-disabled tool rows stay reachable).
//
// Every navigable row here is a `Row`, injected ones included, so the shared
// row marker is the whole selector — and a `Row` that only presents, like the
// add-in's "loading…" lines, carries no marker and stays out of the walk.
// Re-exported under the menu's own name because the
// surfaces that reuse this menu's roving contract — the mention picker, the
// run-mode picker — address it that way.
export { ROW_ITEM_SELECTOR as ADD_MENU_ITEM_SELECTOR };

/**
 * Unified "+" menu for the chat input. Presentational and prop-driven so it
 * can be exercised in isolation (Storybook/tests) without providers. The
 * container decides *what* goes in each section; this component owns only the
 * trigger, the popover, and the row/section layout — including APG-style
 * arrow-key roving focus across the rows.
 */
export function ChatInputAddMenu({
  fileSources = [],
  tools = [],
  extraSections = [],
  extraContent,
  disabled = false,
  isProcessing = false,
  selectedToolCount = 0,
  className = "",
}: ChatInputAddMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  // The section shown as a page in place of the whole menu, if any.
  const [openPageId, setOpenPageId] = useState<string | null>(null);
  const returnFocusToPageRowRef = useRef<string | null>(null);
  // A key moves focus onto a row, as in the rest of the menu; a tap moves it
  // to the page itself, so no row lights up under the finger.
  const swapByKeyRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const baseId = useId();
  // eslint-disable-next-line lingui/no-unlocalized-strings -- internal DOM id suffix
  const toolsHeaderId = `${baseId}-tools`;

  const isBusy = disabled || isProcessing;
  const hasFileSources = fileSources.length > 0;
  const hasTools = tools.length > 0;

  // Roving focus across the navigable rows (skips natively-disabled ones;
  // aria-disabled tool rows stay reachable so they remain perceivable).
  // Escape + focus-return are handled by AnchoredPopover; this adds navigation.
  useRovingMenuFocus({
    containerRef: panelRef,
    enabled: isOpen,
    itemSelector: ROW_ITEM_SELECTOR,
  });

  const cancelPendingClose = useCallback(() => {
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
  }, []);

  const closeAfterSelect = useCallback(() => {
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = undefined;
      setIsOpen(false);
    }, CLOSE_ON_SELECT_DELAY_MS);
  }, []);

  // Host content closes immediately: hosts open dialogs (or finish an async
  // upload) on selection, and the menu must be gone before an aria-modal takes
  // focus. Same convention as DropdownMenu's confirm dialogs.
  const closeNow = useCallback(() => {
    cancelPendingClose();
    setIsOpen(false);
  }, [cancelPendingClose]);

  // Host content can render nothing (no row to offer right now), which the
  // menu learns only from the DOM; an empty block gets no dividers.
  const [extraContentNode, setExtraContentNode] =
    useState<HTMLDivElement | null>(null);
  const [extraContentEmpty, setExtraContentEmpty] = useState(false);
  useLayoutEffect(() => {
    if (!extraContentNode) return;
    const update = () =>
      setExtraContentEmpty(extraContentNode.childNodes.length === 0);
    update();
    const observer = new MutationObserver(update);
    observer.observe(extraContentNode, { childList: true });
    return () => observer.disconnect();
  }, [extraContentNode]);

  // A close scheduled by a selection must not survive a dismiss-and-reopen —
  // without this, the stale timer closes the freshly reopened menu.
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        cancelPendingClose();
      }
      setOpenPageId(null);
      setIsOpen(open);
    },
    [cancelPendingClose],
  );

  useEffect(() => () => clearTimeout(closeTimerRef.current), []);

  // Opening or leaving a page replaces the rows under focus, so focus moves
  // to the page's first row, or back to the row that opened it.
  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    if (!panel) return;
    const returnTo = returnFocusToPageRowRef.current;
    returnFocusToPageRowRef.current = null;
    const byKey = swapByKeyRef.current;
    swapByKeyRef.current = false;
    let target: HTMLElement | null = null;
    if (openPageId !== null) {
      target = byKey
        ? panel.querySelector<HTMLElement>(ROW_ITEM_SELECTOR)
        : panel.querySelector<HTMLElement>("[data-add-menu-page]");
    } else if (returnTo !== null) {
      target = byKey
        ? panel.querySelector<HTMLElement>(
            `[data-testid="chat-input-add-menu-page-${returnTo}"]`,
          )
        : panel;
    }
    target?.focus();
  }, [isOpen, openPageId]);

  const openPage = (sectionId: string, byKey: boolean) => {
    swapByKeyRef.current = byKey;
    setOpenPageId(sectionId);
  };
  const leavePage = useCallback((byKey: boolean) => {
    swapByKeyRef.current = byKey;
    setOpenPageId((current) => {
      returnFocusToPageRowRef.current = current;
      return null;
    });
  }, []);

  // Arrow left leaves a page, as arrow right on its row opened it.
  useEffect(() => {
    const panel = panelRef.current;
    if (!isOpen || openPageId === null || !panel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        leavePage(true);
      }
    };
    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, [isOpen, openPageId, leavePage]);

  const renderActionRow = (item: AddMenuActionItem, testId: string) => (
    <Row
      key={item.id}
      variant="menu"
      role="menuitem"
      tabIndex={-1}
      disabled={isBusy || item.disabled}
      data-testid={testId}
      onClick={() => {
        // A pending close means a selection already ran; the row stays
        // mounted through the close delay, so swallow re-activations.
        if (closeTimerRef.current !== undefined) {
          return;
        }
        item.onSelect();
        if (item.closesImmediately) {
          closeNow();
          return;
        }
        closeAfterSelect();
      }}
      leading={
        item.icon && (
          <span
            className="flex size-5 shrink-0 items-center justify-center"
            aria-hidden="true"
          >
            {item.icon}
          </span>
        )
      }
    >
      {/* The body is written out rather than handed to Row's `description`
          slot: the label truncates whether or not a second line follows, and
          Row drops the wrapper when there is no description. */}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.label}</span>
        {item.description && (
          <span
            className={clsx(
              "text-xs text-theme-fg-muted",
              item.truncateDescription === true
                ? "line-clamp-2 whitespace-normal break-words"
                : item.truncateDescription === false
                  ? "block whitespace-normal break-words"
                  : "block truncate",
            )}
          >
            {item.description}
          </span>
        )}
      </span>
    </Row>
  );

  const renderToolRow = (tool: AddMenuToolItem, testId: string) => {
    const toolDisabled = isBusy || tool.disabled;
    return (
      <Row
        key={tool.id}
        variant="menu"
        role={tool.exclusive ? "menuitemradio" : "menuitemcheckbox"}
        checked={tool.checked}
        // An unavailable tool still explains itself, so it stays in
        // the tab order and in the roving walk; only the activation
        // goes away.
        disabled={toolDisabled}
        disabledMode="aria"
        tabIndex={-1}
        onClick={
          toolDisabled
            ? undefined
            : () => {
                tool.onToggle();
                if (tool.exclusive) {
                  closeAfterSelect();
                }
              }
        }
        data-testid={testId}
        leading={
          tool.icon && (
            <span
              className="flex size-5 shrink-0 items-center justify-center"
              aria-hidden="true"
            >
              {tool.icon}
            </span>
          )
        }
        trailing={
          <CheckIcon
            className={clsx(
              "size-4 shrink-0 text-theme-fg-primary transition-opacity",
              tool.checked ? "opacity-100" : "opacity-0",
            )}
          />
        }
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate">{tool.label}</span>
          {tool.description && (
            <span className="block text-xs text-theme-fg-muted">
              {tool.description}
            </span>
          )}
        </span>
      </Row>
    );
  };

  const renderSectionItems = (section: AddMenuSection) =>
    section.items.map((item) =>
      isAddMenuToolItem(item)
        ? renderToolRow(item, `chat-input-add-menu-extra-${item.id}`)
        : renderActionRow(item, `chat-input-add-menu-extra-${item.id}`),
    );

  const renderPageRow = (section: AddMenuSection) => (
    <Row
      key={section.id}
      variant="menu"
      role="menuitem"
      tabIndex={-1}
      aria-haspopup="menu"
      aria-expanded={false}
      disabled={isBusy}
      data-testid={`chat-input-add-menu-page-${section.id}`}
      // A click a key produced (Enter, Space) carries no pointer detail.
      onClick={(event: React.MouseEvent) =>
        openPage(section.id, event.detail === 0)
      }
      onKeyDown={(event: React.KeyboardEvent) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          openPage(section.id, true);
        }
      }}
      trailing={
        <span className="flex min-w-0 shrink items-center gap-1 text-theme-fg-muted">
          {section.submenu?.summary != null && (
            <span className="truncate">{section.submenu.summary}</span>
          )}
          <ChevronRightIcon className="size-4 shrink-0" aria-hidden="true" />
        </span>
      }
    >
      <span className="min-w-0 shrink-0">{section.header}</span>
    </Row>
  );

  const renderExtraSection = (section: AddMenuSection) => {
    if (section.submenu && section.header != null) {
      return <div className="flex flex-col">{renderPageRow(section)}</div>;
    }
    // eslint-disable-next-line lingui/no-unlocalized-strings -- internal DOM id suffix
    const headerId = `${baseId}-section-${section.id}`;
    return (
      <div
        className="flex flex-col"
        role={section.header != null ? "group" : undefined}
        aria-labelledby={section.header != null ? headerId : undefined}
      >
        {section.header != null && (
          <PopoverSectionHeader id={headerId}>
            {section.header}
          </PopoverSectionHeader>
        )}
        {renderSectionItems(section)}
      </div>
    );
  };

  const openPageSection =
    openPageId === null
      ? undefined
      : extraSections.find(
          (section) => section.id === openPageId && section.submenu,
        );
  // eslint-disable-next-line lingui/no-unlocalized-strings -- internal DOM id suffix
  const pageHeaderId = `${baseId}-page`;

  // Build the visible sections in order, then interleave dividers so the menu
  // reads as grouped without dangling rules — regardless of which sections the
  // host actually supplies.
  const blocks: { key: string; node: React.ReactNode; empty?: boolean }[] = [];

  if (hasFileSources) {
    blocks.push({
      key: "file-sources",
      node: (
        <div className="flex flex-col">
          {fileSources.map((item) =>
            renderActionRow(item, `chat-input-add-menu-source-${item.id}`),
          )}
        </div>
      ),
    });
  }

  if (extraContent) {
    blocks.push({
      key: "extra-content",
      empty: extraContentEmpty,
      node: (
        <div
          ref={setExtraContentNode}
          className={clsx("flex flex-col", extraContentEmpty && "hidden")}
        >
          {extraContent({ close: closeNow })}
        </div>
      ),
    });
  }

  for (const section of extraSections.filter(
    // Default placement is "aboveTools", so everything that isn't explicitly
    // "belowTools" renders here.
    (s) => s.placement !== "belowTools",
  )) {
    blocks.push({
      key: `extra-${section.id}`,
      node: renderExtraSection(section),
    });
  }

  if (hasTools) {
    blocks.push({
      key: "tools",
      node: (
        <div
          role="group"
          aria-labelledby={toolsHeaderId}
          className="flex flex-col"
        >
          <PopoverSectionHeader id={toolsHeaderId}>
            {t({ id: "chatInput.addMenu.toolsHeader", message: "Tools" })}
          </PopoverSectionHeader>
          {tools.map((tool) =>
            renderToolRow(tool, `chat-input-add-menu-tool-${tool.id}`),
          )}
        </div>
      ),
    });
  }

  for (const section of extraSections.filter(
    (s) => s.placement === "belowTools",
  )) {
    blocks.push({
      key: `extra-${section.id}`,
      node: renderExtraSection(section),
    });
  }

  return (
    <AnchoredPopover
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      panelRef={panelRef}
      ariaHasPopup="menu"
      role="menu"
      preferredOrientation={{ vertical: "top", horizontal: "left" }}
      initialFocusSelector={ROW_ITEM_SELECTOR}
      width="wide"
      dataUi="chat-input-add-menu"
      // Size, radius, hover and disabled states all come from
      // `variant="icon-only"`; the selected tools show as chips beside it.
      trigger={(triggerProps) => (
        <Button
          {...triggerProps}
          variant="icon-only"
          size="sm"
          disabled={isBusy}
          aria-label={
            selectedToolCount > 0
              ? t({
                  id: "chatInput.addMenu.triggerWithTools",
                  message: plural(selectedToolCount, {
                    one: "Add files and tools, # tool switched on",
                    other: "Add files and tools, # tools switched on",
                  }),
                })
              : t({
                  id: "chatInput.addMenu.trigger",
                  message: "Add files and tools",
                })
          }
          data-testid="chat-input-add-menu-trigger"
          className={className}
          icon={
            isProcessing ? (
              <SpinnerIcon size="md" style={TRIGGER_RING_STYLE} />
            ) : selectedToolCount > 0 ? (
              <span className="relative flex">
                <PlusIcon className="size-5" />
                <CountBadge
                  variant="attention"
                  className="absolute -end-2 -top-1.5"
                  data-testid="chat-input-add-menu-badge"
                >
                  {selectedToolCount}
                </CountBadge>
              </span>
            ) : (
              <PlusIcon className="size-5" />
            )
          }
        />
      )}
    >
      <PopoverChrome dataUi="chat-input-add-menu-content">
        {openPageSection ? (
          <div
            role="group"
            aria-labelledby={pageHeaderId}
            tabIndex={-1}
            data-add-menu-page=""
            className="flex flex-col focus:outline-none"
          >
            <Row
              variant="menu"
              role="menuitem"
              tabIndex={-1}
              data-testid="chat-input-add-menu-page-back"
              onClick={(event: React.MouseEvent) =>
                leavePage(event.detail === 0)
              }
              leading={
                <ChevronLeftIcon
                  className="size-4 shrink-0"
                  aria-hidden="true"
                />
              }
            >
              <span className="sr-only">
                {t({ id: "chatInput.addMenu.pageBack", message: "Back:" })}{" "}
              </span>
              <span
                id={pageHeaderId}
                className="min-w-0 flex-1 truncate font-medium"
              >
                {openPageSection.header}
              </span>
            </Row>
            <PopoverSeparator />
            {renderSectionItems(openPageSection)}
          </div>
        ) : (
          blocks.map((block, index) => (
            <Fragment key={block.key}>
              {!block.empty &&
                blocks.slice(0, index).some((before) => !before.empty) && (
                  <PopoverSeparator />
                )}
              {block.node}
            </Fragment>
          ))
        )}
      </PopoverChrome>
    </AnchoredPopover>
  );
}
