import { skipToken } from "@tanstack/react-query";

import { useChatDetail } from "@/lib/generated/v1betaApi/v1betaApiComponents";

/**
 * Owner-and-not-archived, read from chat detail rather than the sidebar
 * listing, whose status filter decides whether an archived chat has a row.
 */
export const useChatCanEdit = (chatId: string | null | undefined): boolean => {
  const { data: chat } = useChatDetail(
    chatId ? { pathParams: { chatId } } : skipToken,
  );
  return Boolean(chat && chat.can_edit && !chat.archived_at);
};
