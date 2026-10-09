import { create } from "zustand";

export const useCompactionStore = create<{
  pending: Record<string, boolean>;
  setPending: (chatId: string, pending: boolean) => void;
}>((set) => ({
  pending: {},
  setPending: (chatId, pending) =>
    set((state) => ({ pending: { ...state.pending, [chatId]: pending } })),
}));
