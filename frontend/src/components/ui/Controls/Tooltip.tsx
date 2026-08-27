import React, { useEffect, useId, useRef, useState } from "react";
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
 * A simple tooltip that shows on hover or when the trigger receives focus.
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
  const tooltipId = useId();

  // Drop a pending show-timer if the trigger unmounts while it is queued.
  useEffect(
    () => () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    },
    [],
  );

  // Queue the tooltip. Used for both pointer hover and keyboard focus, so the
  // help text is reachable without a mouse.
  const showTooltip = () => {
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

  // Hide the tooltip and drop any timer that has not fired yet.
  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  };

  // WCAG 1.4.13: a tooltip must be dismissable without moving the pointer or
  // focus. A document listener (not an onKeyDown on the wrapper) is required
  // because a hover-shown tooltip leaves focus somewhere else entirely.
  // Capture phase + stopPropagation so the Escape that dismisses the tooltip
  // does not also reach ModalBase/AnchoredPopover and close the surrounding
  // dialog. Registered only while visible, so Escape is untouched otherwise.
  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setIsVisible(false);
      }
    };

    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [isVisible]);

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
    // React focus events bubble, so the wrapper sees focus/blur from whatever
    // the child renders without any per-child wiring.
    <div
      ref={triggerRef}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      className="relative inline-flex"
    >
      {/* Point the trigger at the tooltip while it is showing. */}
      {React.cloneElement(
        children as React.ReactElement<{ "aria-describedby"?: string }>,
        { "aria-describedby": isVisible ? tooltipId : undefined },
      )}

      {/* Render tooltip using portal if visible */}
      {isVisible &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
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
