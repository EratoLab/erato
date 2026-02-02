import React, { useState, useRef } from "react";
import { createPortal } from "react-dom";

import type { ReactNode } from "react";

interface TooltipProps {
  /** Content to display in the tooltip */
  content: ReactNode;
  /** Position of the tooltip */
  position?: "top" | "right" | "bottom" | "left";
  /** Delay before showing tooltip (ms) */
  delay?: number;
  /** Child element that will trigger the tooltip */
  children: React.ReactElement;
  /** Additional CSS classes for the tooltip */
  className?: string;
}

/**
 * A simple tooltip component that shows on hover
 */
export const Tooltip: React.FC<TooltipProps> = ({
  content,
  position = "top",
  delay = 300,
  children,
  className = "",
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  // Handle mouse enter to show tooltip
  const handleMouseEnter = () => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set timeout to show tooltip after delay
    timeoutRef.current = setTimeout(() => {
      // Only show tooltip if we have the trigger element
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();

        // Calculate position based on specified position
        let top = 0;
        let left = 0;

        switch (position) {
          case "top":
            top = rect.top - 10;
            left = rect.left + rect.width / 2;
            break;
          case "right":
            top = rect.top + rect.height / 2;
            left = rect.right + 10;
            break;
          case "bottom":
            top = rect.bottom + 10;
            left = rect.left + rect.width / 2;
            break;
          case "left":
            top = rect.top + rect.height / 2;
            left = rect.left - 10;
            break;
        }

        setTooltipPosition({ top, left });
        setIsVisible(true);
      }
    }, delay);
  };

  // Handle mouse leave to hide tooltip
  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  };

  // Position classes based on position prop
  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 -translate-y-2 mb-1",
    right: "left-full top-1/2 -translate-y-1/2 translate-x-2 ml-1",
    bottom: "top-full left-1/2 -translate-x-1/2 translate-y-2 mt-1",
    left: "right-full top-1/2 -translate-y-1/2 -translate-x-2 mr-1",
  };

  // Get position class
  const positionClass = positionClasses[position];

  return (
    <div
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="relative inline-block"
    >
      {/* Clone the child element */}
      {React.cloneElement(children)}

      {/* Render tooltip using portal if visible */}
      {isVisible &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className={`pointer-events-none fixed z-50 ${positionClass} ${className}`}
            style={{
              top: `${tooltipPosition.top}px`,
              left: `${tooltipPosition.left}px`,
            }}
          >
            <div className="whitespace-nowrap rounded bg-theme-bg-secondary px-2 py-1 text-xs text-theme-fg-primary shadow-md">
              {content}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};
