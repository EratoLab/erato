import { t } from "@lingui/core/macro";
import clsx from "clsx";
import React, {
  useState,
  useRef,
  useCallback,
  memo,
  useEffect,
  useId,
} from "react";
import { createPortal } from "react-dom";

import { useClickOutside } from "@/hooks/useClickOutside";
import { useKeyboard } from "@/hooks/useKeyboard";

import { Button } from "./Button";
import { ConfirmationDialog } from "../Modal/ConfirmationDialog";
import { MoreVertical, CheckIcon } from "../icons";

import type { ButtonVariant } from "./Button";

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
}

type Position = {
  vertical: "top" | "bottom";
  horizontal: "left" | "right";
};

const MenuItem = memo(
  ({
    item,
    onSelect,
  }: {
    item: DropdownMenuItem;
    onSelect: (e: React.MouseEvent) => void;
  }) => (
    <button
      className={clsx(
        "w-full px-4 py-2 text-left text-sm",
        "flex items-center gap-2",
        "theme-transition",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "focus:outline-none focus-visible:bg-theme-bg-accent",
        item.variant === "danger"
          ? "text-theme-error-fg hover:bg-theme-error-bg"
          : "text-theme-fg-secondary hover:bg-theme-bg-hover hover:text-theme-fg-primary",
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
      <span className="flex-1">{item.label}</span>
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
  }: DropdownMenuProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isProcessingClick, setIsProcessingClick] = useState(false);
    const clickTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
    const [position, setPosition] = useState<Position>({
      vertical: preferredOrientation?.vertical ?? "bottom",
      horizontal: preferredOrientation?.horizontal ?? align,
    });
    const menuRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [confirmingItem, setConfirmingItem] =
      useState<DropdownMenuItem | null>(null);

    // Use React's useId hook for stable IDs across server/client
    const reactId = useId();
    const menuId = id ?? `dropdown-${reactId}`;

    const updatePosition = useCallback(() => {
      if (!isOpen || !menuRef.current || !buttonRef.current) return;

      const menu = menuRef.current.getBoundingClientRect();
      const trigger = buttonRef.current.getBoundingClientRect();
      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight,
        padding: 8,
      };

      const requiredSpace = {
        vertical: menu.height + viewport.padding,
        horizontal: menu.width + viewport.padding,
      };

      const space = {
        top: trigger.top - viewport.padding,
        bottom: viewport.height - trigger.bottom - viewport.padding,
        left: trigger.left - viewport.padding,
        right: viewport.width - trigger.right - viewport.padding,
      };

      const hasSpace = {
        top: space.top >= requiredSpace.vertical,
        bottom: space.bottom >= requiredSpace.vertical,
        left: space.left >= requiredSpace.horizontal,
        right: space.right >= requiredSpace.horizontal,
      };

      const newPosition: Position = {
        vertical: preferredOrientation?.vertical
          ? hasSpace[preferredOrientation.vertical]
            ? preferredOrientation.vertical
            : space.top > space.bottom
              ? "top"
              : "bottom"
          : space.bottom > space.top
            ? "bottom"
            : "top",
        horizontal: preferredOrientation?.horizontal
          ? hasSpace[preferredOrientation.horizontal]
            ? preferredOrientation.horizontal
            : space.left > space.right
              ? "right"
              : "left"
          : space.right > space.left
            ? "left"
            : "right",
      };

      setPosition(newPosition);
    }, [isOpen, preferredOrientation]);

    const closeMenu = useCallback(() => {
      if (isProcessingClick) return;
      setIsOpen(false);
      buttonRef.current?.focus();
    }, [isProcessingClick]);

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
      [], // Dependencies: setConfirmingItem, setIsProcessingClick, setIsOpen (implicitly via scope)
    );

    const handleConfirmAction = useCallback(() => {
      if (confirmingItem) {
        // We might want setIsProcessingClick around this if onClick is async
        confirmingItem.onClick(); // Execute the original action
        setConfirmingItem(null); // Close the confirmation dialog
        setIsOpen(false); // Close the dropdown menu
      }
    }, [confirmingItem]); // Dependency: setIsOpen (implicitly via scope)

    const handleCancelConfirm = useCallback(() => {
      setConfirmingItem(null); // Just close the confirmation dialog
    }, []);

    useClickOutside(menuRef, closeMenu, isOpen && confirmingItem === null); // Only close if confirm dialog isn't open
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
      updatePosition();
      const handleResize = () => requestAnimationFrame(updatePosition);

      if (isOpen) {
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
      }
    }, [isOpen, updatePosition]);

    useEffect(() => {
      if (isOpen) {
        requestAnimationFrame(() => {
          const firstItem = menuRef.current?.querySelector('[role="menuitem"]');
          if (firstItem instanceof HTMLElement) {
            firstItem.focus();
          }
        });
      }
    }, [isOpen]);

    useEffect(() => {
      return () => {
        if (clickTimeoutRef.current) {
          clearTimeout(clickTimeoutRef.current);
        }
      };
    }, []);

    const renderDropdown = () => {
      if (!isOpen) return null;

      const content = (
        <div
          id={menuId}
          className={clsx(
            "fixed w-48 rounded-md shadow-lg",
            "border border-theme-border bg-theme-bg-primary",
            "z-[9999]",
            "theme-transition",
          )}
          style={{
            top:
              position.vertical === "bottom"
                ? `${buttonRef.current?.getBoundingClientRect().bottom}px`
                : "auto",
            bottom:
              position.vertical === "top"
                ? `${window.innerHeight - (buttonRef.current?.getBoundingClientRect().top ?? 0)}px`
                : "auto",
            left:
              position.horizontal === "left"
                ? `${buttonRef.current?.getBoundingClientRect().left}px`
                : "auto",
            right:
              position.horizontal === "right"
                ? `${window.innerWidth - (buttonRef.current?.getBoundingClientRect().right ?? 0)}px`
                : "auto",
            maxHeight: `calc(${
              position.vertical === "bottom"
                ? window.innerHeight -
                  (buttonRef.current?.getBoundingClientRect().bottom ?? 0)
                : (buttonRef.current?.getBoundingClientRect().top ?? 0)
            }px - 16px)`,
          }}
          role="menu"
          aria-orientation="vertical"
          aria-labelledby={buttonRef.current?.id}
        >
          <div className="overflow-y-auto py-1" role="none">
            {items.map((item, index) => (
              <MenuItem
                key={`${item.label}-${index}`}
                item={item}
                onSelect={(e: React.MouseEvent) => handleMenuItemClick(item, e)}
              />
            ))}
          </div>
        </div>
      );

      return createPortal(content, document.body);
    };

    return (
      <div className={clsx("relative inline-block", className)} ref={menuRef}>
        <Button
          ref={buttonRef}
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
          icon={triggerIcon}
          aria-label={t`Open menu`}
          aria-expanded={isOpen}
          aria-haspopup="true"
          aria-controls={menuId}
        />
        {renderDropdown()}

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
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
DropdownMenu.displayName = "DropdownMenu";
