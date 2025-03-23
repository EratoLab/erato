import React from "react";

import { ConversationIndicator } from "../Message/ConversationIndicator";
import { LoadMoreButton } from "../Message/LoadMoreButton";

import type { ChatMessagesResponse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface MessageListHeaderProps {
  showLoadMoreButton: boolean;
  handleLoadMore: () => void;
  isPending: boolean;
  showBeginningIndicator: boolean;
  apiMessagesResponse?: ChatMessagesResponse;
  paginationStats: {
    displayed: number;
    total: number;
  };
}

/**
 * Header for the message list that shows pagination controls and indicators
 */
export const MessageListHeader = ({
  showLoadMoreButton,
  handleLoadMore,
  isPending,
  showBeginningIndicator,
  apiMessagesResponse,
  paginationStats,
}: MessageListHeaderProps) => {
  return (
    <div className="pb-2">
      {showLoadMoreButton && (
        <LoadMoreButton onClick={handleLoadMore} isPending={isPending} />
      )}
      {showBeginningIndicator && <ConversationIndicator type="beginning" />}

      {/* Debug info in development */}
      {process.env.NODE_ENV === "development" && (
        <div className="sticky right-0 top-0 z-50 text-right text-xs opacity-50">
          Showing{" "}
          {apiMessagesResponse
            ? Math.min(
                apiMessagesResponse.stats.current_offset +
                  apiMessagesResponse.stats.returned_count,
                apiMessagesResponse.stats.total_count,
              )
            : paginationStats.displayed}{" "}
          of {apiMessagesResponse?.stats.total_count ?? paginationStats.total}{" "}
          messages
          {apiMessagesResponse?.stats.has_more && " (more available)"}
        </div>
      )}
    </div>
  );
};
