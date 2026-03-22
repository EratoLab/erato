import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useState, useRef, useCallback, memo, useEffect } from "react";

import { useKeyboard } from "@/hooks/useKeyboard";

import { AnchoredPopover } from "./AnchoredPopover";
import { Button } from "./Button";
import { ConfirmationDialog } from "../Modal/ConfirmationDialog";
import { MoreVertical, CheckIcon } from "../icons";

import type { ButtonVariant } from "./Button";
import type React from "react";

export interface DropdownMenuItem {
  label: string;
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
}

export interface DropdownMenuProps {
  items: DropdownMenuItem[];
  className?: string;
  align?: "left" | "right";
  triggerIcon?: React.ReactNode;
  id?: string;
  preferredOrientation?: {
    vertical: "top" | "bottom";
    horizontal: "left" | "right";
  };
  matchContentWidth?: boolean;
  noWrapItems?: boolean;
  /** Callback fired when dropdown open state changes */
  onOpenChange?: (isOpen: boolean) => void;
}

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
        "w-full text-left text-sm",
        "flex items-center gap-2",
        "theme-transition",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "focus-ring-inset",
        noWrap && "whitespace-nowrap",
        item.variant === "danger"
          ? "text-theme-error-fg hover:bg-theme-error-bg focus:bg-theme-error-bg"
          : "text-theme-fg-secondary hover:bg-theme-bg-hover hover:text-theme-fg-primary focus:bg-theme-bg-accent focus:text-theme-fg-primary",
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
    id,
    preferredOrientation,
    matchContentWidth = false,
    noWrapItems = false,
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

    useKeyboard({
      target: menuRef,
      enabled: isOpen,
      onEscape: closeMenu,
      onTab: (e) => {
        e.preventDefault();
        const menuItems =
          menuRef.current?.querySelectorAll('[role="menuitem"]');
        if (!menuItems?.length) return;

        const currentIndex = Array.from(menuItems).findIndex(
          (item) => item === document.activeElement,
        );

        const nextIndex = e.shiftKey
          ? currentIndex <= 0
            ? menuItems.length - 1
            : currentIndex - 1
          : currentIndex >= menuItems.length - 1
            ? 0
            : currentIndex + 1;

        (menuItems[nextIndex] as HTMLElement).focus();
      },
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
          initialFocusSelector='[role="menuitem"]'
          panelRef={menuRef}
          panelStyle={{
            maxWidth:
              "calc(100vw - (var(--theme-layout-dropdown-viewport-margin) * 2))",
            minWidth: "var(--theme-layout-dropdown-min-width)",
          }}
          panelClassName={clsx(
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
              variant="ghost"
              onClick={triggerProps.onClick}
              className="flex min-w-fit items-center justify-center"
              aria-label={t`Open menu`}
              aria-expanded={triggerProps["aria-expanded"]}
              aria-haspopup={triggerProps["aria-haspopup"]}
              aria-controls={triggerProps["aria-controls"]}
            >
              {triggerIcon}
            </Button>
          )}
        >
          <div className="dropdown-panel-chrome-geometry overflow-y-auto" role="none">
            {items.map((item, index) => (
              <MenuItem
                key={`${item.label}-${index}`}
                item={item}
                noWrap={noWrapItems}
                onSelect={(e: React.MouseEvent) => handleMenuItemClick(item, e)}
              />
            ))}
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
