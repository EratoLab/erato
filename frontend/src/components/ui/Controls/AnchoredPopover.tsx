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

type Orientation = {
  vertical: "top" | "bottom";
  horizontal: "left" | "right";
};

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
  trigger: (props: AnchoredPopoverTriggerProps) => ReactNode;
  children: ReactNode;
  className?: string;
  panelClassName?: string;
  panelStyle?: CSSProperties;
  panelRef?: RefObject<HTMLDivElement | null>;
  viewportPadding?: string;
  id?: string;
  role?: React.AriaRole;
  ariaHasPopup?: AnchoredPopoverTriggerProps["aria-haspopup"];
  preferredOrientation?: Orientation;
  initialFocusSelector?: string;
  dataUi?: string;
}

const VIEWPORT_PADDING = 8;

function resolveCssLengthToPixels(
  value: string,
  referenceElement: HTMLElement,
  fallback: number,
) {
  if (typeof window === "undefined") {
    return fallback;
  }

  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.width = value;

  referenceElement.appendChild(probe);
  const resolvedWidth = probe.getBoundingClientRect().width;
  probe.remove();

  return Number.isFinite(resolvedWidth) && resolvedWidth > 0
    ? resolvedWidth
    : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function AnchoredPopover({
  isOpen,
  onOpenChange,
  trigger,
  children,
  className,
  panelClassName,
  panelStyle,
  panelRef,
  viewportPadding = `${VIEWPORT_PADDING}px`,
  id,
  role,
  ariaHasPopup,
  preferredOrientation,
  initialFocusSelector,
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
    if (!isOpen || !triggerRef.current || !getPanelElement()) {
      return;
    }

    const panelElement = getPanelElement();
    if (!panelElement) {
      return;
    }

    const panelRect = panelElement.getBoundingClientRect();
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
      padding: resolveCssLengthToPixels(
        viewportPadding,
        triggerRef.current,
        VIEWPORT_PADDING,
      ),
    };

    const requiredSpace = {
      vertical: panelRect.height + viewport.padding,
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

    const horizontal = preferredOrientation?.horizontal
      ? hasSpace[preferredOrientation.horizontal]
        ? preferredOrientation.horizontal
        : space.left > space.right
          ? "right"
          : "left"
      : space.right > space.left
        ? "left"
        : "right";

    const desiredLeft =
      horizontal === "left"
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
        ? viewport.height - triggerRect.bottom - viewport.padding
        : triggerRect.top - viewport.padding,
    );

    panelElement.style.top =
      vertical === "bottom" ? `${triggerRect.bottom}px` : "auto";
    panelElement.style.bottom =
      vertical === "top" ? `${viewport.height - triggerRect.top}px` : "auto";
    panelElement.style.left = `${left}px`;
    panelElement.style.maxHeight = `${maxHeight}px`;
  }, [getPanelElement, isOpen, preferredOrientation, viewportPadding]);

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
      if (event.key === "Escape") {
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
    if (!isOpen) {
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
  }, [getPanelElement, initialFocusSelector, isOpen]);

  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      triggerRef.current?.focus();
    }

    wasOpenRef.current = isOpen;
  }, [isOpen]);

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
    <div
      ref={setPanelElement}
      id={panelId}
      className={clsx(
        "anchored-popover-skin theme-transition fixed z-[9999] border focus:outline-none",
        panelClassName,
      )}
      // Focusable container so a pointer-open can hold focus without any item
      // looking pre-selected; roving arrow-key nav then works from here.
      tabIndex={-1}
      // Only runtime values belong here. The panel's surface lives in
      // .anchored-popover-skin: an inline style outranks every author rule, so
      // holding it here made `[data-ui="dropdown-panel"]` — a hook the theming
      // docs advertise as overridable — silently inert for background, border
      // and radius. Positioning is written directly to the node in
      // updatePosition(), so it is unaffected.
      style={{
        ...panelStyle,
        visibility: isPositioned ? "visible" : "hidden",
      }}
      role={role}
      aria-labelledby={triggerId}
      data-ui={dataUi}
    >
      {children}
    </div>
  ) : null;

  return (
    <div className={clsx("relative inline-block", className)}>
      {trigger(triggerProps)}
      {panel ? createPortal(panel, document.body) : null}
    </div>
  );
}
