import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { isImeComposing } from "@/utils/isImeComposing";

import { ChevronLeftIcon, CloseIcon } from "../icons";

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
   * viewport, for narrow panes. `fullscreen` covers the screen inside the safe
   * areas, with no gutter, corner or shadow: on a narrow screen a centred
   * popup only spends its width on margins.
   */
  placement?: "center" | "bottom" | "fullscreen";
  /**
   * A back button before the title, for a dialog that shows one of its pages.
   * It shares the close button's shape, so a theme sizes both at once.
   */
  back?: {
    label: string;
    onBack: () => void;
    ref?: React.Ref<HTMLButtonElement>;
  };
  /** Actions pinned below the scrolling content, so they stay in view. */
  footer?: React.ReactNode;
  /** `alertdialog` for a dialog that interrupts with a message to act on. */
  role?: "dialog" | "alertdialog";
  /**
   * Sets `aria-modal`. Defaults to on for an `alertdialog` only: the dialog
   * neither traps Tab nor makes the page inert, and popovers, tooltips and
   * toasts portal outside it, so screen readers that hide everything outside
   * an `aria-modal` dialog would lose them. Turn it on only for a dialog
   * whose content opens none of those.
   */
  modal?: boolean;
  /** Id of the element that names the dialog when it has no `title`. */
  labelledBy?: string;
  describedBy?: string;
  /** The header's close button; Escape still closes. */
  showCloseButton?: boolean;
  closeOnOverlayClick?: boolean;
}

const HEADER_BUTTON_CLASS =
  "modal-close-geometry focus-ring-tight shrink-0 text-theme-fg-muted hover:bg-theme-bg-secondary";
const HEADER_BUTTON_STYLE: React.CSSProperties = {
  padding: "var(--theme-spacing-modal-close-button-padding)",
};

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
  back,
  footer,
  role = "dialog",
  modal = role === "alertdialog",
  labelledBy,
  describedBy,
  showCloseButton = true,
  closeOnOverlayClick = true,
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
      closeOnOverlayClick &&
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
        // The skin's viewport gutter is unlayered, so a padding utility would
        // lose to it; the sheet narrows the gutter through the skin's variable.
        "modal-overlay-skin fixed inset-0 z-50 flex justify-center",
        placement === "bottom"
          ? "items-end [--modal-viewport-margin:0.5rem]"
          : placement === "fullscreen"
            ? "items-stretch [--modal-viewport-margin:0px]"
            : "items-center",
        className,
      )}
      onMouseDown={handleOverlayMouseDown}
      onClick={handleOverlayClick}
      role="presentation"
      aria-label={t`Close modal overlay`}
      data-ui="modal-overlay"
      data-placement={placement === "center" ? undefined : placement}
    >
      <div
        ref={modalRef}
        className={clsx(
          "modal-shell-skin modal-shell-frame-geometry theme-transition relative flex w-full flex-col overflow-hidden font-sans",
          "focus-ring",
          placement === "bottom" && "max-h-[calc(100%-3.25rem)] max-w-full",
          placement === "fullscreen" && "h-full max-h-none max-w-none",
          contentClassName,
        )}
        // Make the content div focusable
        tabIndex={-1}
        role={role}
        aria-modal={modal ? "true" : undefined}
        aria-labelledby={title ? titleId : labelledBy}
        aria-describedby={describedBy}
        data-ui="modal-shell"
        data-placement={placement === "center" ? undefined : placement}
      >
        {/* Optional Header */}
        {title && (
          <div className="modal-section-geometry flex shrink-0 items-start gap-3 border-b border-theme-border">
            {back ? (
              <button
                ref={back.ref}
                type="button"
                onClick={back.onBack}
                className={HEADER_BUTTON_CLASS}
                style={HEADER_BUTTON_STYLE}
                aria-label={back.label}
                data-ui="modal-back"
              >
                <ChevronLeftIcon className="size-6" />
              </button>
            ) : null}
            <h2
              id={titleId}
              className="min-w-0 flex-1 break-words font-heading text-lg font-semibold text-theme-fg-primary"
            >
              {title}
            </h2>
            {/* Keep the close control beside long titles, including in add-in panes. */}
            {showCloseButton ? (
              <button
                onClick={onClose}
                className={HEADER_BUTTON_CLASS}
                style={HEADER_BUTTON_STYLE}
                aria-label={t`Close modal`}
              >
                <CloseIcon className="size-6" />
              </button>
            ) : null}
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
