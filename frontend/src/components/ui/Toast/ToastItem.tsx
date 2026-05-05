import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { Button } from "../Controls/Button";
import {
  CheckCircleIcon,
  CloseIcon,
  ErrorIcon,
  InfoIcon,
  WarningCircleIcon,
} from "../icons";
import { useToastStore } from "./toastStore";

import type { ToastDescriptor, ToastVariant } from "./types";

const ENTER_DURATION_MS = 200;
const EXIT_DURATION_MS = 150;

const defaultDuration = (toast: ToastDescriptor): number => {
  if (typeof toast.duration === "number") return toast.duration;
  if (toast.actions && toast.actions.length > 0)
    return Number.POSITIVE_INFINITY;
  if (toast.variant === "error") return Number.POSITIVE_INFINITY;
  return 5000;
};

const variantClasses: Record<
  ToastVariant,
  { iconWrap: string; titleColor: string }
> = {
  info: {
    iconWrap: "text-theme-info-fg",
    titleColor: "text-theme-fg-primary",
  },
  success: {
    iconWrap: "text-theme-success-fg",
    titleColor: "text-theme-fg-primary",
  },
  warning: {
    iconWrap: "text-theme-warning-fg",
    titleColor: "text-theme-fg-primary",
  },
  error: {
    iconWrap: "text-theme-error-fg",
    titleColor: "text-theme-error-fg",
  },
};

const variantIcon = (variant: ToastVariant) => {
  const cls = "size-5";
  switch (variant) {
    case "success":
      return <CheckCircleIcon className={cls} />;
    case "warning":
      return <WarningCircleIcon className={cls} />;
    case "error":
      return <ErrorIcon className={cls} />;
    case "info":
      return <InfoIcon className={cls} />;
  }
};

interface ToastItemProps {
  toast: ToastDescriptor;
}

export function ToastItem({ toast }: ToastItemProps) {
  const dismiss = useToastStore((state) => state.dismiss);
  const [phase, setPhase] = useState<"entering" | "active" | "leaving">(
    "entering",
  );
  const isHoveredRef = useRef(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const variant = variantClasses[toast.variant];

  useEffect(() => {
    const enterFrame = window.requestAnimationFrame(() => setPhase("active"));
    return () => window.cancelAnimationFrame(enterFrame);
  }, []);

  const beginDismiss = () => {
    setPhase("leaving");
    setTimeout(() => dismiss(toast.id), EXIT_DURATION_MS);
  };

  useEffect(() => {
    const ms = defaultDuration(toast);
    if (!Number.isFinite(ms)) return;

    const startTimer = () => {
      dismissTimerRef.current = setTimeout(() => {
        if (!isHoveredRef.current) beginDismiss();
      }, ms);
    };
    startTimer();

    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
    // beginDismiss closes over `dismiss`/`toast.id` which are stable references
    // for the lifetime of this descriptor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMouseEnter = () => {
    isHoveredRef.current = true;
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  };

  const handleMouseLeave = () => {
    isHoveredRef.current = false;
    const ms = defaultDuration(toast);
    if (!Number.isFinite(ms)) return;
    dismissTimerRef.current = setTimeout(beginDismiss, ms);
  };

  const transformClass =
    phase === "entering"
      ? "translate-y-2 opacity-0 sm:translate-y-0 sm:translate-x-2"
      : phase === "leaving"
        ? "opacity-0"
        : "translate-y-0 opacity-100 sm:translate-x-0";

  return (
    <div
      role={toast.variant === "error" ? "alert" : "status"}
      className={clsx(
        "pointer-events-auto w-full max-w-sm overflow-hidden rounded-lg border border-theme-border bg-theme-bg-primary shadow-lg",
        "transition duration-200 ease-out",
        transformClass,
      )}
      style={{
        transitionDuration: `${
          phase === "leaving" ? EXIT_DURATION_MS : ENTER_DURATION_MS
        }ms`,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          {toast.hideIcon ? null : (
            <div className={clsx("mt-0.5 shrink-0", variant.iconWrap)}>
              {variantIcon(toast.variant)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className={clsx("text-sm font-medium", variant.titleColor)}>
              {toast.title}
            </p>
            {toast.description ? (
              <p className="mt-1 text-sm text-theme-fg-secondary">
                {toast.description}
              </p>
            ) : null}
            {toast.actions && toast.actions.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {toast.actions.map((action) => (
                  <Button
                    key={action.id}
                    type="button"
                    size="sm"
                    variant={action.variant ?? "secondary"}
                    onClick={() => {
                      action.onClick();
                      beginDismiss();
                    }}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
          <Button
            variant="icon-only"
            size="sm"
            className="-mr-1 -mt-1 shrink-0"
            onClick={beginDismiss}
            icon={<CloseIcon className="size-4" />}
            aria-label={t({
              id: "library.toast.dismiss",
              message: "Dismiss notification",
            })}
          />
        </div>
      </div>
    </div>
  );
}
