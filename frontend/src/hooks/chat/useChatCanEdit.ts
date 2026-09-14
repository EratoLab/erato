import { skipToken } from "@tanstack/react-query";

import { useChatDetail } from "@/lib/generated/v1betaApi/v1betaApiComponents";

// Chat detail, not the sidebar listing, whose status filter hides archived chats.
export const useChatCanEdit = (chatId: string | null | undefined): boolean => {
  const { data: chat } = useChatDetail(
    chatId ? { pathParams: { chatId } } : skipToken,
  );
  return Boolean(chat && chat.can_edit && !chat.archived_at);
};
