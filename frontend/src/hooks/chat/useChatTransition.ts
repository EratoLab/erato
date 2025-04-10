import { useState, useEffect, useMemo } from "react";

// Make the hook more flexible by accepting any record type
interface ChatTransitionProps<T = unknown> {
  messages: Record<string, T> | null | undefined;
  messageOrder: string[];
  isTransitioning: boolean;
}

export function useChatTransition<T = unknown>({
  messages,
  messageOrder,
  isTransitioning,
}: ChatTransitionProps<T>) {
  // Create a state to maintain previous messages during transitions
  const [prevMessages, setPrevMessages] = useState<Record<string, T>>({});
  const [prevMessageOrder, setPrevMessageOrder] = useState<string[]>([]);

  // Keep previous messages during transitions to prevent flickering
  useEffect(() => {
    // Only update the state if we have messages and they've actually changed
    if (
      messages &&
      Object.keys(messages).length > 0 &&
      (JSON.stringify(Object.keys(messages)) !==
        JSON.stringify(Object.keys(prevMessages)) ||
        JSON.stringify(messageOrder) !== JSON.stringify(prevMessageOrder))
    ) {
      setPrevMessages(messages);
      setPrevMessageOrder(messageOrder);
    }
  }, [messages, messageOrder, prevMessages, prevMessageOrder]);

  // Determine which messages to display - current or previous during transitions
  const displayMessages = useMemo(() => {
    if (isTransitioning && (!messages || Object.keys(messages).length === 0)) {
      return prevMessages;
    }

    // If we're transitioning but have new messages, make sure to show both
    // This ensures user messages appear immediately during longer chat history loads
    if (isTransitioning && messages && Object.keys(messages).length > 0) {
      // Combine current and previous messages during transition
      return { ...prevMessages, ...messages };
    }

    return messages ?? {};
  }, [isTransitioning, messages, prevMessages]);

  const displayMessageOrder = useMemo(() => {
    if (isTransitioning && messageOrder.length === 0) {
      return prevMessageOrder;
    }
    return messageOrder;
  }, [isTransitioning, messageOrder, prevMessageOrder]);

  // Determine if we should use virtualization based on message count
  const useVirtualization = useMemo(
    () => displayMessageOrder.length > 30,
    [displayMessageOrder.length],
  );

  return {
    displayMessages,
    displayMessageOrder,
    useVirtualization,
  };
}
