import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  type CSSProperties,
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
  id?: string;
  role?: React.AriaRole;
  ariaHasPopup?: AnchoredPopoverTriggerProps["aria-haspopup"];
  preferredOrientation?: Orientation;
  initialFocusSelector?: string;
  dataUi?: string;
}

const VIEWPORT_PADDING = 8;

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
  const panelId = useMemo(() => id ?? `popover-${reactId}`, [id, reactId]);
  const triggerId = `${panelId}-trigger`;

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
      padding: VIEWPORT_PADDING,
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
      vertical === "top"
        ? `${viewport.height - triggerRect.top}px`
        : "auto";
    panelElement.style.left = `${left}px`;
    panelElement.style.maxHeight = `${maxHeight}px`;
  }, [getPanelElement, isOpen, preferredOrientation]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    updatePosition();

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

    const handlePointerDown = (event: MouseEvent) => {
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

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [getPanelElement, isOpen, onOpenChange]);

  useEffect(() => {
    if (!isOpen || !initialFocusSelector) {
      return;
    }

    requestAnimationFrame(() => {
      const focusTarget = getPanelElement()?.querySelector(initialFocusSelector);
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
      onOpenChange(!isOpen);
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
        "fixed z-[9999] border theme-transition",
        panelClassName,
      )}
      style={{
        backgroundColor: "var(--theme-shell-dropdown)",
        borderColor: "var(--theme-border-divider)",
        borderRadius: "var(--theme-radius-base)",
        boxSizing: "border-box",
        boxShadow: "var(--theme-elevation-dropdown)",
        maxWidth: "calc(100vw - 16px)",
        ...panelStyle,
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
