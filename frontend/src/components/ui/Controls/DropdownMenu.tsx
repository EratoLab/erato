import { t } from "@lingui/core/macro";
import clsx from "clsx";
import {
  useState,
  useRef,
  useCallback,
  useId,
  useMemo,
  memo,
  useEffect,
  Fragment,
} from "react";

import { useRovingMenuFocus } from "@/hooks/ui/useRovingMenuFocus";
import { useKeyboard } from "@/hooks/useKeyboard";

import { AnchoredPopover } from "./AnchoredPopover";
import { Button } from "./Button";
import { ConfirmationDialog } from "../Modal/ConfirmationDialog";
import { MoreVertical, CheckIcon } from "../icons";

import type { ButtonGeometry, ButtonVariant } from "./Button";
import type React from "react";

export interface DropdownMenuItem {
  id?: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "danger";
  disabled?: boolean;
  shortcut?: string;
  confirmAction?: boolean;
  confirmTitle?: string;
  confirmMessage?: string;
  confirmButtonVariant?: ButtonVariant;
  checked?: boolean;
  /**
   * Skip the close delay. Required of any row that opens a dialog: the delayed
   * close returns focus to the trigger *after* the dialog has focused itself,
   * pulling focus out from under the overlay.
   */
  closesImmediately?: boolean;
  /** Group label rendered above this row, opening a new section. */
  sectionHeader?: React.ReactNode;
}

export interface DropdownMenuProps {
  items: DropdownMenuItem[];
  className?: string;
  align?: "left" | "right";
  triggerIcon?: React.ReactNode;
  triggerButtonVariant?: ButtonVariant;
  /** Geometry of the trigger button; "icon" yields a square, centered control. */
  triggerButtonGeometry?: ButtonGeometry;
  triggerButtonClassName?: string;
  id?: string;
  preferredOrientation?: {
    vertical: "top" | "bottom";
    horizontal: "left" | "right";
  };
  matchContentWidth?: boolean;
  noWrapItems?: boolean;
  autoFocusFirstItem?: boolean;
  /** Callback fired when dropdown open state changes */
  onOpenChange?: (isOpen: boolean) => void;
}

// Navigable rows for roving focus and initial keyboard focus; natively-disabled
// items are skipped so arrow keys land only on actionable rows.
// eslint-disable-next-line lingui/no-unlocalized-strings -- CSS selector, not user-facing
const MENU_ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)';

const MenuItem = memo(
  ({
    item,
    onSelect,
    noWrap = false,
  }: {
    item: DropdownMenuItem;
    onSelect: (e: React.MouseEvent) => void;
    noWrap?: boolean;
  }) => (
    <button
      className={clsx(
        "dropdown-item-geometry",
        "w-full rounded-[var(--theme-radius-control)] text-left text-sm",
        "flex items-center gap-2",
        "theme-transition",
        "disabled:cursor-not-allowed disabled:opacity-50",
        // Keyboard-active row: soft rounded highlight with a faint 1px inset
        // border — deliberately lighter than hover/selected and free of the
        // old 2px focus ring, so an arrowed-to item reads as "active" not
        // "pre-selected" (ERMAIN-467).
        "focus:outline-none focus:ring-1 focus:ring-inset",
        noWrap && "whitespace-nowrap",
        item.variant === "danger"
          ? "text-theme-error-fg hover:bg-theme-error-bg focus:bg-theme-error-bg focus:ring-theme-error-border"
          : "text-theme-fg-secondary hover:bg-theme-bg-hover hover:text-theme-fg-primary focus:bg-theme-bg-hover focus:text-theme-fg-primary focus:ring-theme-border-dropdown",
      )}
      onClick={onSelect}
      disabled={item.disabled}
      role="menuitem"
      tabIndex={-1}
      type="button"
    >
      {item.icon && (
        <span className="size-4 shrink-0" aria-hidden="true">
          {item.icon}
        </span>
      )}
      <span className={clsx("flex-1", noWrap && "whitespace-nowrap")}>
        {item.label}
      </span>
      {item.shortcut && (
        <span className="ml-auto text-xs text-theme-fg-muted">
          {item.shortcut}
        </span>
      )}
      {item.checked && (
        <span className="ml-auto text-theme-fg-primary">
          <CheckIcon className="size-4" />
        </span>
      )}
    </button>
  ),
);

// eslint-disable-next-line lingui/no-unlocalized-strings
MenuItem.displayName = "MenuItem";

export const DropdownMenu = memo(
  ({
    items,
    className,
    align = "right",
    triggerIcon = <MoreVertical className="size-4" />,
    triggerButtonVariant = "ghost",
    triggerButtonGeometry,
    triggerButtonClassName,
    id,
    preferredOrientation,
    matchContentWidth = false,
    noWrapItems = false,
    autoFocusFirstItem = true,
    onOpenChange,
  }: DropdownMenuProps) => {
    const [isOpen, setIsOpenState] = useState(false);

    // Custom setIsOpen that also calls onOpenChange
    const setIsOpen = useCallback(
      (open: boolean) => {
        setIsOpenState(open);
        onOpenChange?.(open);
      },
      [onOpenChange],
    );
    const [isProcessingClick, setIsProcessingClick] = useState(false);
    const clickTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
    const menuRef = useRef<HTMLDivElement>(null);
    const baseId = useId();
    const [confirmingItem, setConfirmingItem] =
      useState<DropdownMenuItem | null>(null);

    const closeMenu = useCallback(() => {
      if (isProcessingClick) return;
      setIsOpen(false);
    }, [isProcessingClick, setIsOpen]);

    const handleMenuItemClick = useCallback(
      (item: DropdownMenuItem, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // If confirmation is needed, set the state and return
        if (item.confirmAction) {
          setConfirmingItem(item);
          setIsOpen(false); // Close the dropdown immediately
          return;
        }

        if (item.closesImmediately) {
          setIsOpen(false);
          item.onClick();
          return;
        }

        // Original behavior for non-confirmable items
        setIsProcessingClick(true);
        if (clickTimeoutRef.current) {
          clearTimeout(clickTimeoutRef.current);
        }

        try {
          item.onClick();
        } finally {
          // Close menu slightly delayed for non-confirm items
          clickTimeoutRef.current = setTimeout(() => {
            setIsProcessingClick(false);
            setIsOpen(false);
          }, 100);
        }
      },
      [setIsOpen], // Dependencies: setConfirmingItem, setIsProcessingClick are implicit via scope
    );

    const handleConfirmAction = useCallback(() => {
      if (confirmingItem) {
        // We might want setIsProcessingClick around this if onClick is async
        confirmingItem.onClick(); // Execute the original action
        setConfirmingItem(null); // Close the confirmation dialog
        setIsOpen(false); // Close the dropdown menu
      }
    }, [confirmingItem, setIsOpen]);

    const handleCancelConfirm = useCallback(() => {
      setConfirmingItem(null); // Just close the confirmation dialog
    }, []);

    const sections = useMemo(() => {
      const grouped: {
        key: string;
        header?: React.ReactNode;
        items: { item: DropdownMenuItem; index: number }[];
      }[] = [];
      items.forEach((item, index) => {
        const isNewSection = grouped.length === 0 || item.sectionHeader != null;
        if (isNewSection) {
          grouped.push({
            key: item.id ?? String(index),
            header: item.sectionHeader,
            items: [],
          });
        }
        grouped[grouped.length - 1].items.push({ item, index });
      });
      return grouped;
    }, [items]);

    // ArrowUp/Down/Home/End roving nav across enabled items (WAI-ARIA
    // menu-button pattern). Escape-close + focus-return live in AnchoredPopover;
    // we keep Escape here too so closeMenu can guard against an in-flight click.
    useRovingMenuFocus({
      containerRef: menuRef,
      enabled: isOpen,
      itemSelector: MENU_ITEM_SELECTOR,
    });

    useKeyboard({
      target: menuRef,
      enabled: isOpen,
      onEscape: closeMenu,
    });

    useEffect(() => {
      return () => {
        if (clickTimeoutRef.current) {
          clearTimeout(clickTimeoutRef.current);
        }
      };
    }, []);

    return (
      <>
        <AnchoredPopover
          id={id}
          isOpen={isOpen}
          onOpenChange={setIsOpen}
          className={className}
          role="menu"
          ariaHasPopup="menu"
          preferredOrientation={{
            vertical: preferredOrientation?.vertical ?? "bottom",
            horizontal: preferredOrientation?.horizontal ?? align,
          }}
          initialFocusSelector={
            autoFocusFirstItem ? MENU_ITEM_SELECTOR : undefined
          }
          panelRef={menuRef}
          panelStyle={{
            maxWidth:
              "calc(100vw - (var(--theme-layout-dropdown-viewport-margin) * 2))",
            minWidth: "var(--theme-layout-dropdown-min-width)",
          }}
          panelClassName={clsx(
            "flex flex-col",
            matchContentWidth
              ? "w-max"
              : "w-[var(--theme-layout-dropdown-min-width)]",
          )}
          viewportPadding="var(--theme-layout-dropdown-viewport-margin)"
          dataUi="dropdown-panel"
          trigger={(triggerProps) => (
            <Button
              ref={triggerProps.ref}
              id={triggerProps.id}
              type={triggerProps.type}
              size="sm"
              variant={triggerButtonVariant}
              geometry={triggerButtonGeometry}
              onClick={triggerProps.onClick}
              onKeyDown={triggerProps.onKeyDown}
              className={clsx(
                "flex min-w-fit items-center justify-center",
                triggerButtonClassName,
              )}
              aria-label={t`Open menu`}
              aria-expanded={triggerProps["aria-expanded"]}
              aria-haspopup={triggerProps["aria-haspopup"]}
              aria-controls={triggerProps["aria-controls"]}
            >
              {triggerIcon}
            </Button>
          )}
        >
          <div
            className="dropdown-panel-chrome-geometry min-h-0 flex-1 overflow-y-auto overscroll-contain"
            role="none"
          >
            {sections.map((section, sectionIndex) => {
              const rows = section.items.map(({ item, index }) => (
                <MenuItem
                  key={item.id ?? String(index)}
                  item={item}
                  noWrap={noWrapItems}
                  onSelect={(e: React.MouseEvent) =>
                    handleMenuItemClick(item, e)
                  }
                />
              ));

              if (section.header == null) {
                return <Fragment key={section.key}>{rows}</Fragment>;
              }

              // A labelled run is a group, not just a styled line: without the
              // wrapper the label is orphan text a menu reader never reaches.
              // eslint-disable-next-line lingui/no-unlocalized-strings -- internal DOM id suffix
              const headerId = `${baseId}-section-${sectionIndex}`;
              return (
                <Fragment key={section.key}>
                  {sectionIndex > 0 && (
                    <div
                      role="separator"
                      className="my-1 h-px bg-theme-border"
                    />
                  )}
                  <div role="group" aria-labelledby={headerId}>
                    <div
                      id={headerId}
                      role="presentation"
                      className="px-[var(--theme-spacing-dropdown-padding-x)] pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-theme-fg-muted"
                    >
                      {section.header}
                    </div>
                    {rows}
                  </div>
                </Fragment>
              );
            })}
          </div>
        </AnchoredPopover>

        {/* Render Confirmation Dialog if needed */}
        {confirmingItem && (
          <ConfirmationDialog
            isOpen={true}
            onClose={handleCancelConfirm}
            onConfirm={handleConfirmAction}
            title={confirmingItem.confirmTitle ?? t`Confirm Action`}
            message={
              confirmingItem.confirmMessage ??
              t`Are you sure you want to proceed?`
            }
            confirmButtonVariant={
              confirmingItem.confirmButtonVariant ??
              (confirmingItem.variant === "danger" ? "danger" : "primary")
            }
          />
        )}
      </>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
DropdownMenu.displayName = "DropdownMenu";
