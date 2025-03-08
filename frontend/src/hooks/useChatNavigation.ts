import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { useChatHistory } from "../components/containers/ChatHistoryProvider";

/**
 * Custom hook for handling chat navigation with URL synchronization
 */
export function useChatNavigation() {
  const { createSession, currentSessionId, switchSession } = useChatHistory();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Track if navigation is in progress to prevent loops
  const isNavigating = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clear navigation flag with timeout
  const clearNavigatingFlag = useCallback(() => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new timeout
    timeoutRef.current = setTimeout(() => {
      isNavigating.current = false;
      timeoutRef.current = null;
    }, 100);
  }, []);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Update URL without triggering navigation loops
  const updateUrl = useCallback(
    (chatId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("chatId", chatId);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  // Enhanced switchSession that also updates URL
  const switchSessionWithUrl = useCallback(
    (chatId: string) => {
      // Skip if we're already on this chat or busy
      if (chatId === currentSessionId || isNavigating.current) return;

      // Mark as navigating to prevent loops
      isNavigating.current = true;

      // Update URL and switch session
      updateUrl(chatId);
      switchSession(chatId);

      // Reset navigation flag with managed timeout
      clearNavigatingFlag();
    },
    [currentSessionId, updateUrl, switchSession, clearNavigatingFlag],
  );

  // Handle initial load from URL
  useEffect(() => {
    // Skip if we're already handling navigation
    if (isNavigating.current) return;

    const chatId = searchParams.get("chatId");

    if (chatId) {
      // If URL has a chat ID different from current, switch to it
      if (chatId !== currentSessionId) {
        switchSession(chatId);
      }
    } else if (!currentSessionId) {
      // If no chat ID in URL and no current session, create one
      const newId = createSession();

      // Update URL with the new ID
      isNavigating.current = true;
      updateUrl(newId);

      // Reset navigation flag with managed timeout
      clearNavigatingFlag();
    }
  }, [
    searchParams,
    currentSessionId,
    switchSession,
    createSession,
    updateUrl,
    clearNavigatingFlag,
  ]);

  // Function to create a new chat and update URL
  const createNewChat = useCallback(() => {
    // Skip if busy
    if (isNavigating.current) return "";

    // Create new session
    const newId = createSession();

    // Update URL
    isNavigating.current = true;
    updateUrl(newId);

    // Reset navigation flag with managed timeout
    clearNavigatingFlag();

    return newId;
  }, [createSession, updateUrl, clearNavigatingFlag]);

  return {
    switchSessionWithUrl,
    createNewChat,
  };
}
