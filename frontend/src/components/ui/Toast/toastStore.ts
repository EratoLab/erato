import { create } from "zustand";

import type { ToastDescriptor, ToastInput } from "./types";

interface ToastStore {
  toasts: ToastDescriptor[];
  show: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  /**
   * Retracts whatever currently occupies a dedupe slot. The counterpart to
   * `dedupeKey` on `show`: a caller that owns a slot can take it back without
   * having kept the generated id from whenever it last filled it.
   */
  dismissKey: (dedupeKey: string) => void;
  clear: () => void;
}

let counter = 0;

const nextId = () => {
  counter += 1;
  return `toast-${Date.now().toString(36)}-${counter.toString(36)}`;
};

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  show: (input) => {
    const id = input.id ?? nextId();
    const next: ToastDescriptor = { ...input, id };

    if (input.dedupeKey) {
      const existing = get().toasts.find(
        (toast) => toast.dedupeKey === input.dedupeKey,
      );
      if (existing) {
        existing.onDismiss?.();
      }
      set((state) => ({
        toasts: [
          ...state.toasts.filter(
            (toast) => toast.dedupeKey !== input.dedupeKey,
          ),
          next,
        ],
      }));
      return id;
    }

    set((state) => ({ toasts: [...state.toasts, next] }));
    return id;
  },
  dismiss: (id) => {
    const target = get().toasts.find((toast) => toast.id === id);
    target?.onDismiss?.();
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }));
  },
  dismissKey: (dedupeKey) => {
    const target = get().toasts.find((toast) => toast.dedupeKey === dedupeKey);
    if (!target) return;
    get().dismiss(target.id);
  },
  clear: () => {
    get().toasts.forEach((toast) => toast.onDismiss?.());
    set({ toasts: [] });
  },
}));
