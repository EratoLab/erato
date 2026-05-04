import type { ReactNode } from "react";

export type ToastVariant = "info" | "success" | "warning" | "error";

export interface ToastAction {
  /** Stable id used for `data-testid`-style hooks; not displayed. */
  id: string;
  label: string;
  onClick: () => void;
  /** Visual emphasis. Defaults to `secondary`. */
  variant?: "primary" | "secondary";
}

export interface ToastDescriptor {
  id: string;
  variant: ToastVariant;
  /** Bold, single-line headline. */
  title: ReactNode;
  /** Optional secondary line. */
  description?: ReactNode;
  /**
   * Up to ~3 actions rendered below the description. The toast does not
   * auto-dismiss when actions are present unless `duration` is set explicitly.
   */
  actions?: ToastAction[];
  /**
   * Auto-dismiss after this many ms. Defaults: 5000 for non-error toasts with
   * no actions, otherwise sticky (Infinity) so the user must dismiss.
   */
  duration?: number;
  /**
   * Optional dedupe key — emitting a toast with a key that's already showing
   * replaces the existing one rather than stacking.
   */
  dedupeKey?: string;
  /** Called when the toast is removed (auto, manual, or replaced). */
  onDismiss?: () => void;
}

export type ToastInput = Omit<ToastDescriptor, "id"> & { id?: string };
