import { useToastStore } from "./toastStore";

import type { ToastInput } from "./types";

type Variant = "info" | "success" | "warning" | "error";

const emit = (variant: Variant, input: Omit<ToastInput, "variant">) =>
  useToastStore.getState().show({ ...input, variant });

/**
 * Imperative toast API. Call from anywhere — handlers, effects, async
 * callbacks. Renders into the `<Toaster />` mounted at the app root.
 *
 *     toast.success({ title: "Saved" });
 *     toast.error({ title: "Could not save", description: err.message });
 *     toast.custom({ variant: "info", title: "...", actions: [...] });
 *
 * Returns the toast id, which can be passed to `toast.dismiss(id)`.
 */
export const toast = {
  info: (input: Omit<ToastInput, "variant">) => emit("info", input),
  success: (input: Omit<ToastInput, "variant">) => emit("success", input),
  warning: (input: Omit<ToastInput, "variant">) => emit("warning", input),
  error: (input: Omit<ToastInput, "variant">) => emit("error", input),
  custom: (input: ToastInput) => useToastStore.getState().show(input),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
  clear: () => useToastStore.getState().clear(),
};
