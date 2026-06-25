import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { Fragment, useCallback, useId, useRef, useState } from "react";

import { useKeyboard } from "@/hooks/useKeyboard";

import { AnchoredPopover } from "../Controls/AnchoredPopover";
import { CheckIcon, LoadingIcon, PlusIcon } from "../icons";

import type React from "react";

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
  /** Optional secondary line (e.g. file size, provider hint). */
  description?: React.ReactNode;
  onSelect: () => void;
}

/**
 * A persistent toggle in the "+" menu — a tool/facet that stays selected.
 * Rendered with a checkmark; the menu stays open after toggling so several
 * can be flipped in one pass.
 */
export interface AddMenuToolItem extends AddMenuItemBase {
  checked: boolean;
  onToggle: () => void;
}

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
  items: AddMenuActionItem[];
  /** Placement relative to the Tools group. Defaults to "aboveTools". */
  placement?: "aboveTools" | "belowTools";
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
  /** Disable the whole trigger. */
  disabled?: boolean;
  /** Show a spinner in the trigger while files are uploading/linking. */
  isProcessing?: boolean;
  /**
   * Count badge shown on the "+" trigger (mobile affordance for active
   * tools when chips are hidden). No badge when 0 or undefined.
   */
  selectedCount?: number;
  className?: string;
}

const sectionDivider = "my-1 h-px bg-theme-border";

const rowClassName =
  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-theme-fg-primary transition-colors hover:bg-theme-bg-hover";

// CSS selector for the menu's navigable rows; natively-disabled rows are
// excluded from roving focus (aria-disabled tool rows stay reachable).
// eslint-disable-next-line lingui/no-unlocalized-strings -- CSS selector, not user-facing
const NAVIGABLE_ITEM_SELECTOR = "[data-add-menu-item]:not([disabled])";

function SectionHeader({
  id,
  children,
}: {
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      id={id}
      className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-theme-fg-muted"
    >
      {children}
    </div>
  );
}

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
  disabled = false,
  isProcessing = false,
  selectedCount = 0,
  className = "",
}: ChatInputAddMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  // eslint-disable-next-line lingui/no-unlocalized-strings -- internal DOM id suffix
  const toolsHeaderId = `${baseId}-tools`;

  const isBusy = disabled || isProcessing;
  const hasFileSources = fileSources.length > 0;
  const hasTools = tools.length > 0;
  const showBadge = selectedCount > 0;

  // Roving focus across the navigable rows (skips natively-disabled ones;
  // aria-disabled tool rows stay reachable so they remain perceivable).
  const getNavigableItems = useCallback(
    () =>
      panelRef.current
        ? Array.from(
            panelRef.current.querySelectorAll<HTMLElement>(
              NAVIGABLE_ITEM_SELECTOR,
            ),
          )
        : [],
    [],
  );

  const moveFocus = useCallback(
    (delta: number) => {
      const items = getNavigableItems();
      if (items.length === 0) {
        return;
      }
      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      const nextIndex =
        currentIndex < 0
          ? delta > 0
            ? 0
            : items.length - 1
          : (currentIndex + delta + items.length) % items.length;
      items[nextIndex].focus();
    },
    [getNavigableItems],
  );

  const focusEdge = useCallback(
    (edge: "first" | "last") => {
      const items = getNavigableItems();
      if (items.length === 0) {
        return;
      }
      (edge === "first" ? items[0] : items[items.length - 1]).focus();
    },
    [getNavigableItems],
  );

  const onArrowDown = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      moveFocus(1);
    },
    [moveFocus],
  );
  const onArrowUp = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      moveFocus(-1);
    },
    [moveFocus],
  );
  const onHome = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      focusEdge("first");
    },
    [focusEdge],
  );
  const onEnd = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      focusEdge("last");
    },
    [focusEdge],
  );

  // Escape + focus-return are handled by AnchoredPopover; we add navigation.
  useKeyboard({
    target: panelRef,
    enabled: isOpen,
    onArrowDown,
    onArrowUp,
    onHome,
    onEnd,
  });

  const renderActionRow = (item: AddMenuActionItem, testId: string) => (
    <button
      key={item.id}
      type="button"
      role="menuitem"
      tabIndex={-1}
      data-add-menu-item=""
      onClick={() => {
        item.onSelect();
        setIsOpen(false);
      }}
      disabled={isBusy || item.disabled}
      data-testid={testId}
      className={clsx(
        rowClassName,
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      {item.icon && (
        <span className="flex size-5 shrink-0 items-center justify-center text-theme-fg-secondary">
          {item.icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.label}</span>
        {item.description && (
          <span className="block truncate text-xs text-theme-fg-muted">
            {item.description}
          </span>
        )}
      </span>
    </button>
  );

  const renderExtraSection = (section: AddMenuSection) => {
    // eslint-disable-next-line lingui/no-unlocalized-strings -- internal DOM id suffix
    const headerId = `${baseId}-section-${section.id}`;
    return (
      <div
        className="flex flex-col"
        role={section.header != null ? "group" : undefined}
        aria-labelledby={section.header != null ? headerId : undefined}
      >
        {section.header != null && (
          <SectionHeader id={headerId}>{section.header}</SectionHeader>
        )}
        {section.items.map((item) =>
          renderActionRow(item, `chat-input-add-menu-extra-${item.id}`),
        )}
      </div>
    );
  };

  // Build the visible sections in order, then interleave dividers so the menu
  // reads as grouped without dangling rules — regardless of which sections the
  // host actually supplies.
  const blocks: { key: string; node: React.ReactNode }[] = [];

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
          <SectionHeader id={toolsHeaderId}>
            {t({ id: "chatInput.addMenu.toolsHeader", message: "Tools" })}
          </SectionHeader>
          {tools.map((tool) => {
            const toolDisabled = isBusy || tool.disabled;
            return (
              <button
                key={tool.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={tool.checked}
                aria-disabled={toolDisabled ? true : undefined}
                tabIndex={-1}
                data-add-menu-item=""
                onClick={toolDisabled ? undefined : tool.onToggle}
                data-testid={`chat-input-add-menu-tool-${tool.id}`}
                className={clsx(
                  rowClassName,
                  "aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
                )}
              >
                {tool.icon && (
                  <span className="flex size-5 shrink-0 items-center justify-center text-theme-fg-secondary">
                    {tool.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{tool.label}</span>
                <CheckIcon
                  className={clsx(
                    "size-4 shrink-0 text-theme-fg-accent transition-opacity",
                    tool.checked ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            );
          })}
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
      onOpenChange={setIsOpen}
      panelRef={panelRef}
      ariaHasPopup="menu"
      role="menu"
      preferredOrientation={{ vertical: "top", horizontal: "left" }}
      initialFocusSelector={NAVIGABLE_ITEM_SELECTOR}
      panelClassName="w-[min(20rem,calc(100vw-16px))] overflow-y-auto p-1"
      dataUi="chat-input-add-menu"
      trigger={(triggerProps) => (
        <button
          {...triggerProps}
          disabled={isBusy}
          aria-label={t({
            id: "chatInput.addMenu.trigger",
            message: "Add files and tools",
          })}
          data-testid="chat-input-add-menu-trigger"
          className={clsx(
            "relative inline-flex size-9 items-center justify-center rounded-md",
            "text-theme-fg-secondary transition-colors hover:bg-theme-bg-hover",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          {isProcessing ? (
            <LoadingIcon className="size-5 animate-spin" />
          ) : (
            <PlusIcon className="size-5" />
          )}
          {showBadge && !isProcessing && (
            <span
              data-testid="chat-input-add-menu-badge"
              className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-theme-action-primary-bg px-1 text-[10px] font-semibold leading-4 text-theme-action-primary-fg"
            >
              {selectedCount}
            </span>
          )}
        </button>
      )}
    >
      <div className="flex flex-col" data-ui="chat-input-add-menu-content">
        {blocks.map((block, index) => (
          <Fragment key={block.key}>
            {index > 0 && <div className={sectionDivider} />}
            {block.node}
          </Fragment>
        ))}
      </div>
    </AnchoredPopover>
  );
}
