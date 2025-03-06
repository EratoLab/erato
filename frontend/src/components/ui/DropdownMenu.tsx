import clsx from "clsx";
import React, { useState, useRef, useCallback, memo, useEffect } from "react";
import { createPortal } from "react-dom";

import { useClickOutside } from "@/hooks/useClickOutside";
import { useKeyboard } from "@/hooks/useKeyboard";

import { Button } from "./Button";
import { MoreVertical } from "./icons";

export interface DropdownMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "danger";
  disabled?: boolean;
  shortcut?: string;
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
        "w-full px-4 py-2 text-sm text-left",
        "flex items-center gap-2",
        "theme-transition",
        "disabled:opacity-50 disabled:cursor-not-allowed",
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
        <span className="w-4 h-4 flex-shrink-0" aria-hidden="true">
          {item.icon}
        </span>
      )}
      <span className="flex-1">{item.label}</span>
      {item.shortcut && (
        <span className="ml-auto text-theme-fg-muted text-xs">
          {item.shortcut}
        </span>
      )}
    </button>
  ),
);

MenuItem.displayName = "MenuItem";

export const DropdownMenu = memo(
  ({
    items,
    className,
    align = "right",
    triggerIcon = <MoreVertical className="w-4 h-4" />,
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
    const menuId = id ?? `dropdown-${Math.random().toString(36).slice(2)}`;

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

        setIsProcessingClick(true);

        if (clickTimeoutRef.current) {
          clearTimeout(clickTimeoutRef.current);
        }

        try {
          item.onClick();
        } finally {
          clickTimeoutRef.current = setTimeout(() => {
            setIsProcessingClick(false);
            setIsOpen(false);
          }, 100);
        }
      },
      [],
    );

    useClickOutside(menuRef, closeMenu, isOpen);
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
          const firstItem = menuRef.current?.querySelector(
            '[role="menuitem"]',
          ) as HTMLElement;
          firstItem.focus();
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
            "bg-theme-bg-primary border border-theme-border",
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
          <div className="py-1 overflow-y-auto" role="none">
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
          aria-label="Open menu"
          aria-expanded={isOpen}
          aria-haspopup="true"
          aria-controls={menuId}
        />
        {renderDropdown()}
      </div>
    );
  },
);

DropdownMenu.displayName = "DropdownMenu";
