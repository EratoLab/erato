import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { ToastItem } from "./ToastItem";
import { useToastStore } from "./toastStore";

export type ToasterPlacement =
  | "bottom-right"
  | "bottom-left"
  | "bottom-center"
  | "top-right"
  | "top-left"
  | "top-center";

interface ToasterProps {
  /** Where on the viewport to anchor the toast stack. Default `bottom-right`. */
  placement?: ToasterPlacement;
}

const placementClasses: Record<ToasterPlacement, string> = {
  "bottom-right": "items-end justify-end sm:items-end",
  "bottom-left": "items-end justify-start sm:items-start",
  "bottom-center": "items-end justify-center",
  "top-right": "items-start justify-end sm:items-end",
  "top-left": "items-start justify-start sm:items-start",
  "top-center": "items-start justify-center",
};

// The viewport-layer-* edge follows an on-screen keyboard (globals.css).
const placementOrigin: Record<ToasterPlacement, string> = {
  "bottom-right":
    "viewport-layer-bottom fixed inset-x-0 bottom-0 sm:inset-x-auto sm:right-0",
  "bottom-left":
    "viewport-layer-bottom fixed inset-x-0 bottom-0 sm:inset-x-auto sm:left-0",
  "bottom-center": "viewport-layer-bottom fixed inset-x-0 bottom-0",
  "top-right":
    "viewport-layer-top fixed inset-x-0 top-0 sm:inset-x-auto sm:right-0",
  "top-left":
    "viewport-layer-top fixed inset-x-0 top-0 sm:inset-x-auto sm:left-0",
  "top-center": "viewport-layer-top fixed inset-x-0 top-0",
};

/**
 * Renders queued toasts. Mount once, near the app root. The container is a
 * portal anchored to `document.body` so it can escape any overflow / transform
 * ancestors that would otherwise clip a fixed-position element.
 */
export function Toaster({ placement = "bottom-right" }: ToasterProps) {
  const toasts = useToastStore((state) => state.toasts);
  const [container] = useState(() =>
    typeof document === "undefined" ? null : document.createElement("div"),
  );

  useEffect(() => {
    if (!container) return;
    document.body.appendChild(container);
    return () => {
      container.remove();
    };
  }, [container]);

  if (!container) return null;

  return createPortal(
    <div
      aria-label={t({
        id: "library.toast.region",
        message: "Notifications",
      })}
      className={clsx(
        "pointer-events-none z-[1000] flex flex-col gap-2 p-4 sm:p-6",
        "mb-[var(--safe-area-bottom)] ml-[var(--safe-area-left)] mr-[var(--safe-area-right)] mt-[var(--safe-area-top)]",
        placementOrigin[placement],
        placementClasses[placement],
      )}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>,
    container,
  );
}
