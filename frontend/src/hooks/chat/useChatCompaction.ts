import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import { env } from "@/app/env";
import { clientPlatformHeaders } from "@/lib/clientPlatform";
import {
  useCompactChat,
  chatMessagesQuery,
  fetchChatMessages,
  chatDetailQuery,
  recentChatsQuery,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { mapApiMessageToUiMessage } from "@/utils/adapters/messageAdapter";

import { getClientToolHeaders } from "./clientToolExecutors";
import { useCompactionStore } from "./store/compactionStore";
import { useGenerationStatusStore } from "./store/generationStatusStore";
import { useMessagingStore } from "./store/messagingStore";
import { useChatCanEdit } from "./useChatCanEdit";

export function useChatCompaction({
  chatId,
  previousMessageId,
  chatProviderId,
  selectedFacetIds,
  disabled,
}: {
  chatId?: string | null;
  previousMessageId?: string | null;
  chatProviderId?: string;
  selectedFacetIds: string[];
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const canEdit = useChatCanEdit(
    env().chatHistoryCompactionEnabled ? chatId : null,
  );
  const isPending = useCompactionStore(
    (state) => !!chatId && state.pending[chatId] === true,
  );
  const status = useGenerationStatusStore((state) =>
    chatId ? state.statusByChatId[chatId]?.kind : undefined,
  );
  // Keep the operation ID across uncertain failures so a retry cannot compact twice.
  const operation = useRef<{ tip: string; id: string } | null>(null);
  const mutation = useCompactChat({
    onSuccess: async (_response, variables) => {
      const chatId = variables.pathParams.chatId;
      const parameters = { pathParams: { chatId } };
      const response = await fetchChatMessages(parameters);
      queryClient.setQueryData(
        chatMessagesQuery(parameters).queryKey,
        response,
      );
      useMessagingStore
        .getState()
        .setApiMessages(
          response.messages
            .filter((m) => m.is_message_in_active_thread)
            .map(mapApiMessageToUiMessage),
          chatId,
        );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tokenEstimation"] }),
        queryClient.invalidateQueries({
          queryKey: chatDetailQuery(parameters).queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: recentChatsQuery({}).queryKey,
        }),
      ]);
      operation.current = null;
    },
    onSettled: (_data, _error, variables) =>
      useCompactionStore
        .getState()
        .setPending(variables.pathParams.chatId, false),
  });
  const available =
    !!env().chatHistoryCompactionEnabled &&
    !!chatId &&
    !!previousMessageId &&
    canEdit &&
    !disabled &&
    status !== "running" &&
    status !== "action_required";
  const compact = () => {
    if (
      !available ||
      !chatId ||
      !previousMessageId ||
      useCompactionStore.getState().pending[chatId]
    )
      return;
    if (operation.current?.tip !== previousMessageId)
      operation.current = {
        tip: previousMessageId,
        id: window.crypto.randomUUID(),
      };
    const body = {
      expected_tip_message_id: previousMessageId,
      operation_id: operation.current.id,
      target_chat_provider_id: chatProviderId,
      selected_facet_ids: selectedFacetIds,
    };
    useCompactionStore.getState().setPending(chatId, true);
    mutation.mutate({
      pathParams: { chatId },
      body,
      headers: { ...clientPlatformHeaders(), ...getClientToolHeaders() },
    });
  };
  return { available, compact, isPending, error: mutation.error };
}
