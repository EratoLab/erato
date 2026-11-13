import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { isImeComposing } from "@/utils/isImeComposing";

import { PopoverPanel, resolvePopoverViewportPadding } from "./PopoverPanel";

import type { PopoverWidth } from "./PopoverPanel";

type Orientation = {
  vertical: "top" | "bottom";
  /** `center` centres the panel on the anchor and needs no side to have room. */
  horizontal: "left" | "right" | "center";
};

/** A rectangle in viewport coordinates, as `getBoundingClientRect` reports it. */
export interface AnchoredPopoverRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface AnchoredPopoverTriggerProps {
  ref: RefObject<HTMLButtonElement | null>;
  id: string;
  type: "button";
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  "aria-expanded": boolean;
  "aria-controls": string;
  "aria-haspopup"?: "menu" | "dialog" | "listbox" | "tree" | "grid";
}

export interface AnchoredPopoverProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omitted when the panel is anchored to `anchorRect`. */
  trigger?: (props: AnchoredPopoverTriggerProps) => ReactNode;
  /**
   * Anchor the panel to this rectangle instead of a trigger: marked text has
   * no element of its own. The owner opens and closes the panel, so such a
   * popover also sets `manageFocus={false}` and names itself with `ariaLabel`.
   */
  anchorRect?: AnchoredPopoverRect | null;
  /** Pixels between the anchor and the panel. */
  anchorGap?: number;
  children: ReactNode;
  className?: string;
  panelClassName?: string;
  panelStyle?: CSSProperties;
  panelRef?: RefObject<HTMLDivElement | null>;
  /** Panel width dialect; see PopoverPanel. */
  width?: PopoverWidth;
  /** See PopoverPanel; off lets the panel be narrower than a menu. */
  widthFloor?: boolean;
  viewportPadding?: string;
  id?: string;
  role?: React.AriaRole;
  ariaHasPopup?: AnchoredPopoverTriggerProps["aria-haspopup"];
  preferredOrientation?: Orientation;
  initialFocusSelector?: string;
  /**
   * Focus-on-open and focus-return-on-close assume the open was initiated at
   * the trigger. A popover opened from elsewhere — a typeahead driven by the
   * caret, say — must set this false and place focus itself, or the panel steals
   * the caret out of whatever the user is typing into.
   */
  manageFocus?: boolean;
  /** Panel accessible name, for triggers that carry none. */
  ariaLabel?: string;
  dataUi?: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function AnchoredPopover({
  isOpen,
  onOpenChange,
  trigger,
  anchorRect,
  anchorGap = 0,
  children,
  className,
  panelClassName,
  panelStyle,
  panelRef,
  width = "min",
  widthFloor = true,
  viewportPadding = "var(--theme-layout-dropdown-viewport-margin)",
  id,
  role,
  ariaHasPopup,
  preferredOrientation,
  initialFocusSelector,
  manageFocus = true,
  ariaLabel,
  dataUi = "anchored-popover-panel",
}: AnchoredPopoverProps) {
  const reactId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const internalPanelRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  // How the current open was initiated. Keyboard opens (Enter/Space/ArrowDown
  // on the trigger) focus the first item; pointer opens focus only the panel
  // container so nothing looks pre-selected. See the focus effect below.
  const openViaKeyboardRef = useRef(false);
  const panelId = useMemo(() => id ?? `popover-${reactId}`, [id, reactId]);
  // eslint-disable-next-line lingui/no-unlocalized-strings -- internal DOM id suffix
  const triggerId = `${panelId}-trigger`;

  // Keep the panel hidden until it has been measured & positioned, so it never
  // paints a first frame at its unclamped flow height.
  const [isPositioned, setIsPositioned] = useState(false);

  const getPanelElement = useCallback(
    () => panelRef?.current ?? internalPanelRef.current,
    [panelRef],
  );

  const setPanelElement = useCallback(
    (element: HTMLDivElement | null) => {
      internalPanelRef.current = element;
      if (panelRef) {
        panelRef.current = element;
      }
    },
    [panelRef],
  );

  const updatePosition = useCallback(() => {
    const panelElement = getPanelElement();
    const triggerRect =
      anchorRect ?? triggerRef.current?.getBoundingClientRect();
    if (!isOpen || !triggerRect || !panelElement) {
      return;
    }

    const panelRect = panelElement.getBoundingClientRect();
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
      padding: resolvePopoverViewportPadding(
        viewportPadding,
        triggerRef.current ?? panelElement,
      ),
    };

    const requiredSpace = {
      vertical: panelRect.height + anchorGap + viewport.padding,
      horizontal: panelRect.width + viewport.padding,
    };

    const space = {
      top: triggerRect.top - viewport.padding,
      bottom: viewport.height - triggerRect.bottom - viewport.padding,
      left: triggerRect.left - viewport.padding,
      right: viewport.width - triggerRect.right - viewport.padding,
    };

    const hasSpace = {
      top: space.top >= requiredSpace.vertical,
      bottom: space.bottom >= requiredSpace.vertical,
      left: space.left >= requiredSpace.horizontal,
      right: space.right >= requiredSpace.horizontal,
    };

    const vertical = preferredOrientation?.vertical
      ? hasSpace[preferredOrientation.vertical]
        ? preferredOrientation.vertical
        : space.top > space.bottom
          ? "top"
          : "bottom"
      : space.bottom > space.top
        ? "bottom"
        : "top";

    const preferredHorizontal = preferredOrientation?.horizontal;
    const horizontal =
      preferredHorizontal === "center"
        ? "center"
        : preferredHorizontal
          ? hasSpace[preferredHorizontal]
            ? preferredHorizontal
            : space.left > space.right
              ? "right"
              : "left"
          : space.right > space.left
            ? "left"
            : "right";

    const desiredLeft =
      horizontal === "center"
        ? (triggerRect.left + triggerRect.right - panelRect.width) / 2
        : horizontal === "left"
          ? triggerRect.left
          : triggerRect.right - panelRect.width;
    const maxLeft = Math.max(
      viewport.padding,
      viewport.width - panelRect.width - viewport.padding,
    );
    const left = clamp(desiredLeft, viewport.padding, maxLeft);
    const maxHeight = Math.max(
      0,
      vertical === "bottom"
        ? viewport.height - triggerRect.bottom - anchorGap - viewport.padding
        : triggerRect.top - anchorGap - viewport.padding,
    );

    panelElement.style.top =
      vertical === "bottom" ? `${triggerRect.bottom + anchorGap}px` : "auto";
    panelElement.style.bottom =
      vertical === "top"
        ? `${viewport.height - triggerRect.top + anchorGap}px`
        : "auto";
    panelElement.style.left = `${left}px`;
    panelElement.style.maxHeight = `${maxHeight}px`;
  }, [
    anchorGap,
    anchorRect,
    getPanelElement,
    isOpen,
    preferredOrientation,
    viewportPadding,
  ]);

  // Position before paint (not in a post-paint useEffect): a bottom-anchored
  // panel would otherwise paint one frame at unclamped height past the viewport
  // bottom, adding a document-root scrollbar (ERMAIN-464).
  useLayoutEffect(() => {
    if (!isOpen) {
      setIsPositioned(false);
      return;
    }

    updatePosition();
    setIsPositioned(true);

    const handleViewportChange = () => {
      requestAnimationFrame(updatePosition);
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (
        triggerRef.current?.contains(target) ||
        getPanelElement()?.contains(target)
      ) {
        return;
      }

      onOpenChange(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isImeComposing(event)) {
        event.preventDefault();
        onOpenChange(false);
      }
    };

    // pointerdown (not mousedown) so tap-outside dismisses on touch surfaces
    // (Outlook add-in / mobile), where synthesized mousedown is delayed/suppressed.
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [getPanelElement, isOpen, onOpenChange]);

  useEffect(() => {
    if (!isOpen || !manageFocus) {
      return;
    }

    requestAnimationFrame(() => {
      const panelElement = getPanelElement();
      if (!panelElement) {
        return;
      }

      // Keyboard-open (WAI-ARIA menu-button pattern): focus the first item so
      // arrow keys start from a defined position. Pointer-open: focus only the
      // panel container so nothing looks pre-selected — arrows still work
      // because the roving handler is bound to the panel and falls back to the
      // first/last item when nothing is focused within it.
      const focusTarget =
        openViaKeyboardRef.current && initialFocusSelector
          ? panelElement.querySelector(initialFocusSelector)
          : panelElement;

      if (focusTarget instanceof HTMLElement) {
        focusTarget.focus();
      }
    });
  }, [getPanelElement, initialFocusSelector, isOpen, manageFocus]);

  // Return focus only when it went down with the panel (it is on the body
  // then). A selection that moved it on purpose, into the composer or a dialog,
  // keeps it, even when the menu closes after its select delay.
  useEffect(() => {
    if (
      manageFocus &&
      wasOpenRef.current &&
      !isOpen &&
      (document.activeElement === null ||
        document.activeElement === document.body)
    ) {
      triggerRef.current?.focus();
    }

    wasOpenRef.current = isOpen;
  }, [isOpen, manageFocus]);

  const triggerProps: AnchoredPopoverTriggerProps = {
    ref: triggerRef,
    id: triggerId,
    type: "button",
    onClick: (event) => {
      event.preventDefault();
      event.stopPropagation();
      // Space/Enter dispatch a synthetic click; detail === 0 marks a
      // keyboard-driven activation (a real pointer click has detail >= 1).
      openViaKeyboardRef.current = event.detail === 0;
      onOpenChange(!isOpen);
    },
    onKeyDown: (event) => {
      // ArrowDown/ArrowUp open the menu and land on the first/last item, per
      // the WAI-ARIA menu-button pattern. Enter/Space fall through to onClick.
      if (!isOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        openViaKeyboardRef.current = true;
        onOpenChange(true);
      }
    },
    "aria-expanded": isOpen,
    "aria-controls": panelId,
    "aria-haspopup": ariaHasPopup,
  };

  const panel = isOpen ? (
    <PopoverPanel
      ref={setPanelElement}
      positioned="fixed"
      width={width}
      widthFloor={widthFloor}
      dataUi={dataUi}
      id={panelId}
      // The flex column is the panel's own contract, not a caller's: the
      // max-height written in updatePosition() only contains the rows while
      // their wrapper can shrink against it.
      className={clsx("z-[9999] flex flex-col", panelClassName)}
      // Focusable container so a pointer-open can hold focus without any item
      // looking pre-selected; roving arrow-key nav then works from here.
      tabIndex={-1}
      // Only runtime values belong here. The panel's surface and shape live in
      // classes and the shape attributes: an inline style outranks every author
      // rule, so holding them here made the panel's `data-ui` hook — which the
      // theming docs advertise as overridable — silently inert for background,
      // border and radius. Positioning is written directly to the node in
      // updatePosition(), so it is unaffected.
      style={{
        ...panelStyle,
        visibility: isPositioned ? "visible" : "hidden",
      }}
      role={role}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel || !trigger ? undefined : triggerId}
    >
      {children}
    </PopoverPanel>
  ) : null;

  if (!trigger) {
    return panel ? createPortal(panel, document.body) : null;
  }

  return (
    <div className={clsx("relative inline-block", className)}>
      {trigger(triggerProps)}
      {panel ? createPortal(panel, document.body) : null}
    </div>
  );
}
