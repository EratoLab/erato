import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { isImeComposing } from "@/utils/isImeComposing";

import { CloseIcon } from "../icons";

import type React from "react";

interface ModalBaseProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  className?: string;
  contentClassName?: string;
  /**
   * `bottom` docks the dialog as a near-full-width sheet at the foot of the
   * viewport, for narrow panes.
   */
  placement?: "center" | "bottom";
  /** Actions pinned below the scrolling content, so they stay in view. */
  footer?: React.ReactNode;
}

// Open dialogs, newest last. Escape belongs to the newest only, so a preview
// stacked over another dialog closes alone.
const openModals: object[] = [];

const isTopModal = (token: object) => openModals.at(-1) === token;

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
  placement = "center",
  footer,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  // Dialogs stack (a file preview over a conversation), so each names itself.
  const titleId = useId();
  const mouseDownTargetRef = useRef<EventTarget | null>(null);
  const [token] = useState(() => ({}));

  // Declared before the focus-in effect below, so the opener is read before
  // focus moves into the dialog.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    openModals.push(token);
    const shell = modalRef.current;
    const active = document.activeElement;
    // An autoFocus child has already taken focus; its opener is unknown.
    const opener =
      active instanceof HTMLElement && !shell?.contains(active) ? active : null;
    return () => {
      const index = openModals.lastIndexOf(token);
      if (index !== -1) {
        openModals.splice(index, 1);
      }
      // Only when focus would otherwise be lost: a caller that moved focus on
      // purpose while closing keeps it where it put it.
      const active = document.activeElement;
      const focusLost =
        active === null ||
        active === document.body ||
        Boolean(shell?.contains(active));
      if (focusLost && opener?.isConnected) {
        opener.focus();
      }
    };
  }, [isOpen, token]);

  // Close modal on Escape key press
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !isImeComposing(event) &&
        isTopModal(token)
      ) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
    } else {
      document.removeEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose, token]);

  // Keyed on opening alone: callers pass inline onClose closures, and
  // refocusing on each new one pulled focus out of the dialog's fields on
  // every parent render.
  useEffect(() => {
    if (isOpen && !modalRef.current?.contains(document.activeElement)) {
      modalRef.current?.focus();
    }
  }, [isOpen]);

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

  const modalContent = (
    <div
      className={clsx(
        // Alignment lives here, not in `className`: Tailwind emits
        // items-center after items-end, so a caller could not override it.
        // The skin's viewport gutter is unlayered, hence the important inset.
        placement === "bottom"
          ? "modal-overlay-skin fixed inset-0 z-50 flex items-end justify-center !p-2"
          : "modal-overlay-skin fixed inset-0 z-50 flex items-center justify-center",
        className,
      )}
      onMouseDown={handleOverlayMouseDown}
      onClick={handleOverlayClick}
      role="presentation"
      aria-label={t`Close modal overlay`}
      data-ui="modal-overlay"
    >
      <div
        ref={modalRef}
        className={clsx(
          "modal-shell-skin modal-shell-frame-geometry theme-transition relative flex w-full flex-col overflow-hidden font-sans",
          "focus-ring",
          placement === "bottom" && "max-h-[calc(100%-3.25rem)] max-w-full",
          contentClassName,
        )}
        // Make the content div focusable
        tabIndex={-1}
        role="dialog"
        aria-labelledby={title ? titleId : undefined}
        data-ui="modal-shell"
        data-placement={placement === "bottom" ? "bottom" : undefined}
      >
        {/* Optional Header */}
        {title && (
          <div className="modal-section-geometry flex shrink-0 items-start gap-3 border-b border-theme-border">
            <h2
              id={titleId}
              className="min-w-0 flex-1 break-words font-heading text-lg font-semibold text-theme-fg-primary"
            >
              {title}
            </h2>
            {/* Keep the close control beside long titles, including in add-in panes. */}
            <button
              onClick={onClose}
              className="modal-close-geometry focus-ring-tight shrink-0 text-theme-fg-muted hover:bg-theme-bg-secondary"
              style={{
                padding: "var(--theme-spacing-modal-close-button-padding)",
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
        {footer ? (
          <div
            data-ui="modal-footer"
            className="modal-section-geometry shrink-0 border-t border-theme-border"
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

// eslint-disable-next-line lingui/no-unlocalized-strings
ModalBase.displayName = "ModalBase";
