import { create } from "zustand";
import { devtools } from "zustand/middleware";

/**
 * Tracks unresolved tool-consent confirmation cards per chat — the add-in's
 * client-action `ActionConfirmationCard`s and the shared `McpToolApprovalCard`
 * — so the message queue's auto-send drain can hold while a consent question
 * is still pending (ERMAIN-470).
 *
 * A card registers itself while it is in the "pending" state and deregisters
 * once resolved (allow/deny) or when its renderer unmounts.
 *
 * The hold is best-effort: a card whose renderer is unmounted (e.g. scrolled
 * out of a virtualized message list) deregisters, so it can't wedge the queue.
 *
 * A card that only waits for delegated tasks registers `waitingOnly`: it holds
 * the queue the same way, but nothing is asked of the user.
 */
export interface ConfirmationRegistrationOptions {
  waitingOnly?: boolean;
}

interface ConfirmationRegistryStore {
  // chatId -> registration ids of currently-pending confirmation cards.
  pendingIdsByChatId: Partial<Record<string, string[]>>;
  // The registration ids that only wait for tasks, across chats.
  waitingOnlyIds: Partial<Record<string, true>>;
  registerConfirmation: (
    chatId: string,
    registrationId: string,
    options?: ConfirmationRegistrationOptions,
  ) => void;
  unregisterConfirmation: (chatId: string, registrationId: string) => void;
  hasPending: (chatId: string | null | undefined) => boolean;
}

const hasPendingIn = (
  pendingIdsByChatId: Partial<Record<string, string[]>>,
  chatId: string | null | undefined,
): boolean => (chatId ? (pendingIdsByChatId[chatId]?.length ?? 0) > 0 : false);

const onlyWaitingIn = (
  state: Pick<
    ConfirmationRegistryStore,
    "pendingIdsByChatId" | "waitingOnlyIds"
  >,
  chatId: string | null | undefined,
): boolean => {
  const pending = chatId ? state.pendingIdsByChatId[chatId] : undefined;
  return (
    !!pending &&
    pending.length > 0 &&
    pending.every((id) => state.waitingOnlyIds[id] === true)
  );
};

const withWaitingOnly = (
  waitingOnlyIds: Partial<Record<string, true>>,
  registrationId: string,
  waitingOnly: boolean,
): Partial<Record<string, true>> => {
  if ((waitingOnlyIds[registrationId] === true) === waitingOnly) {
    return waitingOnlyIds;
  }
  const next = { ...waitingOnlyIds };
  if (waitingOnly) {
    next[registrationId] = true;
  } else {
    delete next[registrationId];
  }
  return next;
};

export const useConfirmationRegistryStore = create<ConfirmationRegistryStore>()(
  devtools(
    (set, get) => ({
      pendingIdsByChatId: {},
      waitingOnlyIds: {},
      registerConfirmation: (chatId, registrationId, options = {}) =>
        set(
          (prev) => {
            const existing = prev.pendingIdsByChatId[chatId] ?? [];
            const waitingOnlyIds = withWaitingOnly(
              prev.waitingOnlyIds,
              registrationId,
              options.waitingOnly ?? false,
            );
            if (existing.includes(registrationId)) {
              return waitingOnlyIds === prev.waitingOnlyIds
                ? prev
                : { waitingOnlyIds };
            }
            return {
              pendingIdsByChatId: {
                ...prev.pendingIdsByChatId,
                [chatId]: [...existing, registrationId],
              },
              waitingOnlyIds,
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
            return {
              pendingIdsByChatId: nextByChatId,
              waitingOnlyIds: withWaitingOnly(
                prev.waitingOnlyIds,
                registrationId,
                false,
              ),
            };
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

/**
 * Reactive read of whether every unresolved card of `chatId` only waits for
 * delegated tasks, so nothing the user can answer holds the queue.
 */
export const useOnlyWaitingConfirmations = (
  chatId: string | null | undefined,
): boolean =>
  useConfirmationRegistryStore((state) => onlyWaitingIn(state, chatId));
