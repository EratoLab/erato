import React from "react";

import { ConversationIndicator } from "../Message/ConversationIndicator";
import { LoadMoreButton } from "../Message/LoadMoreButton";

import type { ChatMessagesResponse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface MessageListHeaderProps {
  showLoadMoreButton: boolean;
  handleLoadMore: () => void;
  isLoading: boolean;
  showBeginningIndicator: boolean;
  apiMessagesResponse?: ChatMessagesResponse;
  paginationStats: {
    displayed: number;
    total: number;
  };
}

export const MessageListHeader: React.FC<MessageListHeaderProps> = ({
  showLoadMoreButton,
  handleLoadMore,
  isLoading,
  showBeginningIndicator,
  apiMessagesResponse,
  paginationStats,
}) => {
  return (
    <>
      {/* Load more button */}
      {showLoadMoreButton && (
        <LoadMoreButton onClick={handleLoadMore} isLoading={isLoading} />
      )}

      {/* Beginning of conversation indicator */}
      {showBeginningIndicator && <ConversationIndicator type="beginning" />}

      {/* Debug info in development */}
      {process.env.NODE_ENV === "development" && (
        <div className="sticky right-0 top-0 z-50 text-right text-xs opacity-50">
          Showing{" "}
          {apiMessagesResponse?.stats.returned_count ??
            paginationStats.displayed}{" "}
          of {apiMessagesResponse?.stats.total_count ?? paginationStats.total}{" "}
          messages
          {apiMessagesResponse?.stats.has_more && " (more available)"}
        </div>
      )}
    </>
  );
};
