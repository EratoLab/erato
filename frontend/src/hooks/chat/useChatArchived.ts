import { skipToken } from "@tanstack/react-query";

import { useChatDetail } from "@/lib/generated/v1betaApi/v1betaApiComponents";

// `undefined` until the chat is known: a surface stays live through the fetch,
// but must not announce a pending decision it may not get to make.
export const useChatArchived = (
  chatId: string | null | undefined,
): boolean | undefined => {
  const { data: chat } = useChatDetail(
    chatId ? { pathParams: { chatId } } : skipToken,
  );
  return chat ? Boolean(chat.archived_at) : undefined;
};
