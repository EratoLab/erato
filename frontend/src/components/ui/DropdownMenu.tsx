import React, { useState, useRef, useCallback, memo, useEffect } from "react";
import clsx from "clsx";
import { Button } from "./Button";
import { MoreVertical } from "./icons";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useKeyboard } from "../../hooks/useKeyboard";
import { createPortal } from 'react-dom';

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
  /**
   * Preferred orientation for the dropdown
   * Will still flip if there's not enough space
   */
  preferredOrientation?: {
    vertical: 'top' | 'bottom';
    horizontal: 'left' | 'right';
  };
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

type Position = {
  vertical: 'top' | 'bottom';
  horizontal: 'left' | 'right';
};

export const DropdownMenu = memo(({
  items,
  className,
  align = "right",
  triggerIcon = <MoreVertical className="w-4 h-4" />,
  id,
  preferredOrientation,
}: DropdownMenuProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<Position>({ 
    vertical: preferredOrientation?.vertical || 'bottom', 
    horizontal: preferredOrientation?.horizontal || align 
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = id || `dropdown-${Math.random().toString(36).slice(2)}`;

  const updatePosition = useCallback(() => {
    if (!isOpen || !menuRef.current || !buttonRef.current) return;

    const menu = menuRef.current.getBoundingClientRect();
    const trigger = buttonRef.current.getBoundingClientRect();
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
      padding: 8,
    };

    // Calculate required space for the menu
    const requiredSpace = {
      vertical: menu.height + viewport.padding,
      horizontal: menu.width + viewport.padding,
    };

    // Calculate available space in each direction
    const space = {
      top: trigger.top - viewport.padding,
      bottom: viewport.height - trigger.bottom - viewport.padding,
      left: trigger.left - viewport.padding,
      right: viewport.width - trigger.right - viewport.padding,
    };

    // Determine if each position has enough space
    const hasSpace = {
      top: space.top >= requiredSpace.vertical,
      bottom: space.bottom >= requiredSpace.vertical,
      left: space.left >= requiredSpace.horizontal,
      right: space.right >= requiredSpace.horizontal,
    };

    // If preferred orientation is specified, use it unless there's not enough space
    // Then use the direction with more available space
    // TODO: this could be improved if we use the actual size of our dropdown
    const newPosition: Position = {
      vertical: preferredOrientation?.vertical 
        ? (hasSpace[preferredOrientation.vertical]
            ? preferredOrientation.vertical 
            : space.top > space.bottom ? 'top' : 'bottom')
        : (space.bottom > space.top ? 'bottom' : 'top'),
      horizontal: preferredOrientation?.horizontal
        ? (hasSpace[preferredOrientation.horizontal]
            ? preferredOrientation.horizontal
            : space.left > space.right ? 'right' : 'left')
        : (space.right > space.left ? 'left' : 'right'),
    };

    setPosition(newPosition);
  }, [isOpen, preferredOrientation]);

  // Update position when menu opens or window resizes
  useEffect(() => {
    updatePosition();
    
    const handleResize = () => {
      requestAnimationFrame(updatePosition);
    };

    if (isOpen) {
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, [isOpen, updatePosition]);

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

  const renderDropdown = () => {
    if (!isOpen) return null;

    const content = (
      <div
        id={menuId}
        className={clsx(
          "fixed w-48 rounded-md shadow-lg", // Changed from absolute to fixed
          "bg-theme-bg-primary border border-theme-border",
          "z-[9999]", // Highest z-index to ensure it's above everything
          "transition-all duration-200"
        )}
        style={{
          top: position.vertical === 'bottom' 
            ? `${buttonRef.current?.getBoundingClientRect().bottom}px`
            : 'auto',
          bottom: position.vertical === 'top' 
            ? `${window.innerHeight - buttonRef.current?.getBoundingClientRect().top}px`
            : 'auto',
          left: position.horizontal === 'left'
            ? `${buttonRef.current?.getBoundingClientRect().left}px`
            : 'auto',
          right: position.horizontal === 'right'
            ? `${window.innerWidth - buttonRef.current?.getBoundingClientRect().right}px`
            : 'auto',
          maxHeight: `calc(${
            position.vertical === 'bottom' 
              ? window.innerHeight - buttonRef.current?.getBoundingClientRect().bottom 
              : buttonRef.current?.getBoundingClientRect().top
          }px - 16px)`
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
              onSelect={closeMenu}
            />
          ))}
        </div>
      </div>
    );

    return createPortal(content, document.body);
  };

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
      {renderDropdown()}
    </div>
  );
});

DropdownMenu.displayName = 'DropdownMenu';
