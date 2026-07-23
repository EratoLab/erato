import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useChatHistoryStore } from "@/hooks/chat/useChatHistory";
import { useChatContext } from "@/providers/ChatProvider";
import { createLogger } from "@/utils/debugLogger";

const logger = createLogger("UI", "ChatDetailPage(ID)");

/**
 * The generated API client surfaces an empty-body HTTP error (the shape the
 * backend returns for a missing/unauthorized chat's history GET) as
 * `{ status, payload }`, so a definitive 404 is detectable via the numeric
 * `status`. A send error carried on the same slot is a plain `Error` with no
 * `status`, so it never matches here.
 */
const isNotFoundError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  error.status === 404;

export default function ChatDetailPage() {
  // No sync logic needed - currentChatId is automatically derived from URL in useChatHistory
  const navigate = useNavigate();
  const { currentChatId, messagingError } = useChatContext();
  const isNewChatPending = useChatHistoryStore(
    (state) => state.isNewChatPending,
  );
  const pendingChatId = useChatHistoryStore((state) => state.pendingChat?.id);

  // A chat the user opened directly that does not exist or that they cannot
  // access resolves its history GET to 404: send them to the blank composer
  // rather than render a surface for a chat that is not there. A freshly created
  // chat returns 200 on that same GET (its row already exists by the time the
  // chat_created event navigates here) and is still marked pending in the
  // sidebar, so the create window never counts as "missing" and never bounces.
  // Archived chats stay readable (200) and likewise never match.
  const chatNotFound =
    !!currentChatId &&
    !isNewChatPending &&
    pendingChatId !== currentChatId &&
    isNotFoundError(messagingError);

  useEffect(() => {
    if (chatNotFound) {
      logger.log(
        `ChatDetailPage: history GET for ${currentChatId} returned 404 - redirecting to /chat/new`,
      );
      navigate("/chat/new", { replace: true });
    }
  }, [chatNotFound, currentChatId, navigate]);

  return null; // The ChatLayout handles UI
}
