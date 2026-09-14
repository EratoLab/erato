import { skipToken } from "@tanstack/react-query";

import { useChatDetail } from "@/lib/generated/v1betaApi/v1betaApiComponents";

// False until the chat is known, so a surface stays live through the fetch
// rather than flickering closed on every open.
export const useChatArchived = (chatId: string | null | undefined): boolean => {
  const { data: chat } = useChatDetail(
    chatId ? { pathParams: { chatId } } : skipToken,
  );
  return Boolean(chat?.archived_at);
};
