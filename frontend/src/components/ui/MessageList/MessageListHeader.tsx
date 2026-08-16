import { ConversationIndicator } from "../Message/ConversationIndicator";
import { LoadMoreButton } from "../Message/LoadMoreButton";

interface MessageListHeaderProps {
  showLoadMoreButton: boolean;
  handleLoadMore: () => void;
  isPending: boolean;
  showBeginningIndicator: boolean;
}

/**
 * Header for the message list that shows pagination controls and indicators
 */
export const MessageListHeader = ({
  showLoadMoreButton,
  handleLoadMore,
  isPending,
  showBeginningIndicator,
}: MessageListHeaderProps) => {
  return (
    <div
      className="chat-header-skin pb-2"
      data-testid="chat-header-shell"
      data-ui="chat-header"
    >
      {showLoadMoreButton && (
        <LoadMoreButton onClick={handleLoadMore} isPending={isPending} />
      )}
      {showBeginningIndicator && <ConversationIndicator type="beginning" />}
    </div>
  );
};
