import React, { useState, useRef, useEffect } from "react";
import clsx from "clsx";
import { Button } from "./Button";
import { MoreVertical } from "./icons";

export interface DropdownMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "danger";
  disabled?: boolean;
}

interface DropdownMenuProps {
  items: DropdownMenuItem[];
  className?: string;
  align?: "left" | "right";
  triggerIcon?: React.ReactNode;
}

export const DropdownMenu: React.FC<DropdownMenuProps> = ({
  items,
  className,
  align = "right",
  triggerIcon = <MoreVertical className="w-4 h-4" />,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className={clsx("relative inline-block", className)} ref={menuRef}>
      <Button
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
      />

      {isOpen && (
        <div
          className={clsx(
            "absolute mt-1 w-48 rounded-md shadow-lg",
            "bg-theme-bg-primary border border-theme-border",
            "z-50",
            align === "right" ? "right-0" : "left-0",
          )}
          role="menu"
          aria-orientation="vertical"
        >
          <div className="py-1" role="none">
            {items.map((item, index) => (
              <button
                key={index}
                className={clsx(
                  "w-full px-4 py-2 text-sm text-left",
                  "flex items-center gap-2",
                  "hover:bg-theme-bg-accent",
                  "transition-colors duration-150",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  item.variant === "danger" &&
                    "text-theme-danger hover:text-theme-danger-hover",
                  "focus:outline-none focus:bg-theme-bg-accent",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  item.onClick();
                  setIsOpen(false);
                }}
                disabled={item.disabled}
                role="menuitem"
              >
                {item.icon && (
                  <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>
                )}
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
