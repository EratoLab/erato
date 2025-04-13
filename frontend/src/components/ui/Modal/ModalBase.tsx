import clsx from "clsx";
import React, { useEffect, useRef } from "react";

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

  // Close modal on overlay click
  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={clsx(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm",
        className,
      )}
      onClick={handleOverlayClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          onClose();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label="Close modal overlay"
    >
      <div
        ref={modalRef}
        className={clsx(
          "theme-transition relative max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-lg bg-theme-bg-primary shadow-xl",
          // Add default focus outline for accessibility
          "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
          contentClassName,
        )}
        // Make the content div focusable
        tabIndex={-1}
        role="dialog"
        aria-labelledby={title ? "modal-title" : undefined}
      >
        {/* Optional Header */}
        {title && (
          <div className="border-b border-theme-border p-4">
            <h2
              id="modal-title"
              className="text-lg font-semibold text-theme-fg-primary"
            >
              {title}
            </h2>
            {/* Simple Close Button */}
            <button
              onClick={onClose}
              className="absolute right-3 top-3 rounded-full p-1 text-theme-fg-muted hover:bg-theme-bg-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Close modal"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="size-6"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        )}

        {/* Content */}
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
};

ModalBase.displayName = "ModalBase";
