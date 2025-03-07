import clsx from "clsx";
import { useCallback, useEffect, useRef } from "react";

import type { ChatMessage as ChatMessageType } from "../../containers/ChatProvider";

/**
 * Helper function to create CSS class names for message highlighting
 */
export const useMessageClassNameHelper = () => {
  return useCallback(
    (isNew: boolean) =>
      clsx(
        "mx-auto w-full sm:w-[85%]",
        "py-4",
        "transition-all duration-700 ease-in-out",
        isNew
          ? "animate-fadeIn bg-theme-bg-accent border-l-4 border-theme-accent pl-2"
          : "bg-transparent",
      ),
    [],
  );
};

/**
 * Hook to inject animation keyframes into the document
 */
export const useMessageAnimations = () => {
  useEffect(() => {
    // Only inject if not already present
    if (!document.getElementById("message-animations")) {
      const style = document.createElement("style");
      style.id = "message-animations";
      style.innerHTML = `
        @keyframes fadeIn {
          from { opacity: 0.7; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.5s ease-out forwards;
        }
      `;
      document.head.appendChild(style);
    }

    // Clean up on unmount
    return () => {
      const style = document.getElementById("message-animations");
      if (style) {
        document.head.removeChild(style);
      }
    };
  }, []);
};

/**
 * Hook for estimating message sizes for virtualization
 */
export const useMessageSizeEstimation = (
  messages: Record<string, ChatMessageType>,
) => {
  const messageSizeCache = useRef<{ [key: string]: number }>({});

  const estimateMessageSize = useCallback(
    (messageId: string) => {
      if (messageSizeCache.current[messageId]) {
        return messageSizeCache.current[messageId];
      }

      const message = messages[messageId];
      // Message will always exist here based on how messageId is used

      // Base height for message UI elements
      const baseHeight = 70;

      // Estimate content height based on character count
      // Average 100 chars per line, 20px line height
      const contentLength = message.content.length;
      const estimatedLines = Math.ceil(contentLength / 100);
      const contentHeight = Math.max(20, estimatedLines * 20);

      // Store in cache
      const totalHeight = baseHeight + contentHeight;
      messageSizeCache.current[messageId] = totalHeight;

      return totalHeight;
    },
    [messages],
  );

  return estimateMessageSize;
};
