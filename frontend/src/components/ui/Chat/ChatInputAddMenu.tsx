import { t } from "@lingui/core/macro";
import clsx from "clsx";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
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
import { CheckIcon, PlusIcon } from "../icons";

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
  /** Optional secondary line (e.g. file size, provider hint). */
  description?: React.ReactNode;
  /**
   * Skip the close delay. Required of any row that opens a dialog: the delayed
   * close returns focus to the trigger *after* the dialog has focused itself,
   * pulling focus out from under the overlay.
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
   * Count badge shown on the "+" trigger (mobile affordance for active
   * tools when chips are hidden). No badge when 0 or undefined.
   */
  selectedCount?: number;
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
  selectedCount = 0,
  className = "",
}: ChatInputAddMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const baseId = useId();
  // eslint-disable-next-line lingui/no-unlocalized-strings -- internal DOM id suffix
  const toolsHeaderId = `${baseId}-tools`;

  const isBusy = disabled || isProcessing;
  const hasFileSources = fileSources.length > 0;
  const hasTools = tools.length > 0;
  const showBadge = selectedCount > 0;

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
  // upload) on selection, and AnchoredPopover focus-returns to the trigger on
  // close — delaying past the dialog's own focus grab would steal focus from
  // an open aria-modal. Same convention as DropdownMenu's confirm dialogs.
  const closeNow = useCallback(() => {
    cancelPendingClose();
    setIsOpen(false);
  }, [cancelPendingClose]);

  // A close scheduled by a selection must not survive a dismiss-and-reopen —
  // without this, the stale timer closes the freshly reopened menu.
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        cancelPendingClose();
      }
      setIsOpen(open);
    },
    [cancelPendingClose],
  );

  useEffect(() => () => clearTimeout(closeTimerRef.current), []);

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
          <span className="block truncate text-xs text-theme-fg-muted">
            {item.description}
          </span>
        )}
      </span>
    </Row>
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
          <PopoverSectionHeader id={headerId}>
            {section.header}
          </PopoverSectionHeader>
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

  if (extraContent) {
    blocks.push({
      key: "extra-content",
      node: (
        <div className="flex flex-col">{extraContent({ close: closeNow })}</div>
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
          {tools.map((tool) => {
            const toolDisabled = isBusy || tool.disabled;
            return (
              <Row
                key={tool.id}
                variant="menu"
                role="menuitemcheckbox"
                checked={tool.checked}
                // An unavailable tool still explains itself, so it stays in
                // the tab order and in the roving walk; only the activation
                // goes away.
                disabled={toolDisabled}
                disabledMode="aria"
                tabIndex={-1}
                onClick={toolDisabled ? undefined : tool.onToggle}
                data-testid={`chat-input-add-menu-tool-${tool.id}`}
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
                <span className="min-w-0 flex-1 truncate">{tool.label}</span>
              </Row>
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
      onOpenChange={handleOpenChange}
      panelRef={panelRef}
      ariaHasPopup="menu"
      role="menu"
      preferredOrientation={{ vertical: "top", horizontal: "left" }}
      initialFocusSelector={ROW_ITEM_SELECTOR}
      width="wide"
      dataUi="chat-input-add-menu"
      // `relative` is the only styling this needs beyond the shared Button:
      // it anchors the absolutely-positioned count badge. Size, radius, hover
      // and disabled states all come from `variant="icon-only"`, which this
      // previously hand-rolled with the same tokens.
      trigger={(triggerProps) => (
        <Button
          {...triggerProps}
          variant="icon-only"
          size="sm"
          disabled={isBusy}
          aria-label={t({
            id: "chatInput.addMenu.trigger",
            message: "Add files and tools",
          })}
          data-testid="chat-input-add-menu-trigger"
          className={clsx("relative", className)}
          icon={
            isProcessing ? (
              <SpinnerIcon size="md" style={TRIGGER_RING_STYLE} />
            ) : (
              <PlusIcon className="size-5" />
            )
          }
        >
          {showBadge && !isProcessing && (
            <CountBadge
              variant="attention"
              // Stays in the accessibility tree: the trigger's label does
              // not carry the selection count, so the badge must.
              aria-hidden={false}
              data-testid="chat-input-add-menu-badge"
              className="absolute -right-0.5 -top-0.5"
            >
              {selectedCount}
            </CountBadge>
          )}
        </Button>
      )}
    >
      <PopoverChrome dataUi="chat-input-add-menu-content">
        {blocks.map((block, index) => (
          <Fragment key={block.key}>
            {index > 0 && <PopoverSeparator />}
            {block.node}
          </Fragment>
        ))}
      </PopoverChrome>
    </AnchoredPopover>
  );
}
