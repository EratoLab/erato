import { create } from "zustand";
import { devtools } from "zustand/middleware";

/**
 * Tracks unresolved client-action confirmation cards (the add-in's
 * `ActionConfirmationCard`) per chat, so the message queue's auto-send drain
 * can hold while a tool-consent question is still pending (ERMAIN-470).
 *
 * A card registers itself while it is in the "pending" state and deregisters
 * once resolved (allow/deny) or when its renderer unmounts. The web surface
 * has no confirmation cards, so nothing ever registers and every drain reads
 * `hasPending === false`.
 *
 * The hold is best-effort: a card whose renderer is unmounted (e.g. scrolled
 * out of a virtualized message list) deregisters, so it can't wedge the queue.
 */
interface ConfirmationRegistryStore {
  // chatId -> registration ids of currently-pending confirmation cards.
  pendingIdsByChatId: Partial<Record<string, string[]>>;
  registerConfirmation: (chatId: string, registrationId: string) => void;
  unregisterConfirmation: (chatId: string, registrationId: string) => void;
  hasPending: (chatId: string | null | undefined) => boolean;
}

const hasPendingIn = (
  pendingIdsByChatId: Partial<Record<string, string[]>>,
  chatId: string | null | undefined,
): boolean =>
  chatId ? (pendingIdsByChatId[chatId]?.length ?? 0) > 0 : false;

export const useConfirmationRegistryStore = create<ConfirmationRegistryStore>()(
  devtools(
    (set, get) => ({
      pendingIdsByChatId: {},
      registerConfirmation: (chatId, registrationId) =>
        set(
          (prev) => {
            const existing = prev.pendingIdsByChatId[chatId] ?? [];
            if (existing.includes(registrationId)) {
              return prev;
            }
            return {
              pendingIdsByChatId: {
                ...prev.pendingIdsByChatId,
                [chatId]: [...existing, registrationId],
              },
            };
          },
          false,
          "confirmationRegistry/registerConfirmation",
        ),
      unregisterConfirmation: (chatId, registrationId) =>
        set(
          (prev) => {
            const existing = prev.pendingIdsByChatId[chatId];
            if (!existing?.includes(registrationId)) {
              return prev;
            }
            const next = existing.filter((id) => id !== registrationId);
            const nextByChatId = { ...prev.pendingIdsByChatId };
            if (next.length === 0) {
              delete nextByChatId[chatId];
            } else {
              nextByChatId[chatId] = next;
            }
            return { pendingIdsByChatId: nextByChatId };
          },
          false,
          "confirmationRegistry/unregisterConfirmation",
        ),
      hasPending: (chatId) => hasPendingIn(get().pendingIdsByChatId, chatId),
    }),
    {
      name: "Confirmation Registry Store",
      store: "confirmation-registry-store",
      enabled: process.env.NODE_ENV === "development",
    },
  ),
);

/**
 * Reactive read of whether `chatId` has any unresolved confirmation card.
 * Returns a boolean, so the default `Object.is` equality keeps re-renders
 * limited to genuine true<->false flips.
 */
export const useHasPendingConfirmation = (
  chatId: string | null | undefined,
): boolean =>
  useConfirmationRegistryStore((state) =>
    hasPendingIn(state.pendingIdsByChatId, chatId),
  );
