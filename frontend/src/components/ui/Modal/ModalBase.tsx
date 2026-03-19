import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { CloseIcon } from "../icons";

import type React from "react";

interface ModalBaseProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  className?: string;
  contentClassName?: string;
}

/**
 * Basic reusable modal component with overlay and focus trap (basic).
 */
export const ModalBase: React.FC<ModalBaseProps> = ({
  isOpen,
  onClose,
  children,
  title,
  className,
  contentClassName,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const mouseDownTargetRef = useRef<EventTarget | null>(null);

  // Close modal on Escape key press
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      // Basic focus trap: focus the modal content when opened
      modalRef.current?.focus();
    } else {
      document.removeEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleOverlayMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    mouseDownTargetRef.current = event.target;
  };

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (
      event.target === event.currentTarget &&
      mouseDownTargetRef.current === event.currentTarget
    ) {
      onClose();
    }
    mouseDownTargetRef.current = null;
  };

  if (!isOpen) {
    return null;
  }

  const overlayStyle = {
    backgroundColor: "var(--theme-overlay-modal)",
  } as const;

  const shellStyle = {
    backgroundColor: "var(--theme-shell-modal)",
    borderRadius: "var(--theme-radius-modal)",
    boxShadow: "var(--theme-elevation-modal)",
  } as const;

  const modalContent = (
    <div
      className={clsx(
        "fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm",
        className,
      )}
      style={overlayStyle}
      onMouseDown={handleOverlayMouseDown}
      onClick={handleOverlayClick}
      role="presentation"
      aria-label={t`Close modal overlay`}
      data-ui="modal-overlay"
    >
      <div
        ref={modalRef}
        className={clsx(
          "theme-transition relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden font-sans",
          // Responsive padding - add margin on mobile
          "mx-4",
          "focus-ring",
          contentClassName,
        )}
        style={shellStyle}
        // Make the content div focusable
        tabIndex={-1}
        role="dialog"
        aria-labelledby={title ? "modal-title" : undefined}
        data-ui="modal-shell"
      >
        {/* Optional Header */}
        {title && (
          <div className="modal-section-geometry shrink-0 border-b border-theme-border">
            <h2
              id="modal-title"
              className="font-heading text-lg font-semibold text-theme-fg-primary"
            >
              {title}
            </h2>
            {/* Simple Close Button — positioned using the same modal padding token */}
            <button
              onClick={onClose}
              className="focus-ring-tight absolute rounded-full p-1 text-theme-fg-muted hover:bg-theme-bg-secondary"
              style={{
                right: "var(--theme-spacing-modal-padding)",
                top: "var(--theme-spacing-modal-padding)",
              }}
              aria-label={t`Close modal`}
            >
              <CloseIcon className="size-6" />
            </button>
          </div>
        )}

        {/* Content - scrollable */}
        <div className="modal-section-geometry flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

// eslint-disable-next-line lingui/no-unlocalized-strings
ModalBase.displayName = "ModalBase";
