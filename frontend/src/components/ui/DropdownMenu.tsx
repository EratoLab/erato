import React, { useState, useRef, useCallback, memo } from "react";
import clsx from "clsx";
import { Button } from "./Button";
import { MoreVertical } from "./icons";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useKeyboard } from "../../hooks/useKeyboard";

export interface DropdownMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "danger";
  disabled?: boolean;
  shortcut?: string; // For keyboard shortcuts display
}

export interface DropdownMenuProps {
  items: DropdownMenuItem[];
  className?: string;
  align?: "left" | "right";
  triggerIcon?: React.ReactNode;
  id?: string; // For ARIA relationships
}

const MenuItem = memo(({ 
  item, 
  onSelect 
}: { 
  item: DropdownMenuItem; 
  onSelect: () => void;
}) => (
  <button
    className={clsx(
      "w-full px-4 py-2 text-sm text-left",
      "flex items-center gap-2",
      "transition-colors duration-150",
      "disabled:opacity-50 disabled:cursor-not-allowed",
      "focus:outline-none focus-visible:bg-theme-bg-accent",
      item.variant === "danger" 
        ? "text-theme-danger hover:text-theme-danger-hover hover:bg-theme-danger-bg" 
        : "hover:bg-theme-bg-accent text-theme-fg-primary",
    )}
    onClick={(e) => {
      e.stopPropagation();
      item.onClick();
      onSelect();
    }}
    disabled={item.disabled}
    role="menuitem"
    tabIndex={-1} // Handle focus management manually
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
));

MenuItem.displayName = 'MenuItem';

export const DropdownMenu = memo(({
  items,
  className,
  align = "right",
  triggerIcon = <MoreVertical className="w-4 h-4" />,
  id,
}: DropdownMenuProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = id || `dropdown-${Math.random().toString(36).slice(2)}`;

  // Close menu and restore focus
  const closeMenu = useCallback(() => {
    setIsOpen(false);
    buttonRef.current?.focus();
  }, []);

  // Handle keyboard navigation
  useKeyboard({
    target: menuRef,
    enabled: isOpen,
    onEscape: closeMenu,
    onTab: (e) => {
      e.preventDefault(); // Always prevent default Tab behavior
      const menuItems = menuRef.current?.querySelectorAll('[role="menuitem"]');
      if (!menuItems?.length) return;

      const currentIndex = Array.from(menuItems).findIndex(
        item => item === document.activeElement
      );
      
      const nextIndex = e.shiftKey 
        ? (currentIndex <= 0 ? menuItems.length - 1 : currentIndex - 1)
        : (currentIndex >= menuItems.length - 1 ? 0 : currentIndex + 1);
      
      (menuItems[nextIndex] as HTMLElement).focus();
    },
  });

  // Handle click outside
  useClickOutside(menuRef, closeMenu, isOpen);

  // Focus first menu item when opening
  React.useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        const firstItem = menuRef.current?.querySelector('[role="menuitem"]') as HTMLElement;
        firstItem?.focus();
      });
    }
  }, [isOpen]);

  return (
    <div 
      className={clsx("relative inline-block", className)} 
      ref={menuRef}
    >
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

      {isOpen && (
        <div
          id={menuId}
          className={clsx(
            "absolute mt-1 w-48 rounded-md shadow-lg",
            "bg-theme-bg-primary border border-theme-border",
            "z-50",
            align === "right" ? "right-0" : "left-0",
          )}
          role="menu"
          aria-orientation="vertical"
          aria-labelledby={buttonRef.current?.id}
        >
          <div className="py-1" role="none">
            {items.map((item, index) => (
              <MenuItem
                key={`${item.label}-${index}`}
                item={item}
                onSelect={closeMenu}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

DropdownMenu.displayName = 'DropdownMenu';
