import { useCallback, useState } from "react";

interface UseTokenManagementProps {
  // Optional initial state
  initialMessageLimitExceeded?: boolean;
  initialFileLimitExceeded?: boolean;
}

/**
 * Hook to manage token limits for messages and file attachments
 * Centralizes token limit state and provides handlers for components
 */
export const useTokenManagement = ({
  initialMessageLimitExceeded = false,
  initialFileLimitExceeded = false,
}: UseTokenManagementProps = {}) => {
  // Token limit states
  const [isMessageTokenLimitExceeded, setIsMessageTokenLimitExceeded] =
    useState(initialMessageLimitExceeded);
  const [isFileTokenLimitExceeded, setIsFileTokenLimitExceeded] = useState(
    initialFileLimitExceeded,
  );

  // Handler for message token limit updates
  const handleMessageTokenLimitExceeded = useCallback((isExceeded: boolean) => {
    setIsMessageTokenLimitExceeded(isExceeded);
  }, []);

  // Handler for file token limit updates
  const handleFileTokenLimitExceeded = useCallback((isExceeded: boolean) => {
    setIsFileTokenLimitExceeded(isExceeded);
  }, []);

  // Utility to check if any limit is exceeded
  const isAnyTokenLimitExceeded =
    isMessageTokenLimitExceeded || isFileTokenLimitExceeded;

  // Reset token limits when files are removed
  const resetTokenLimits = useCallback(
    (messageLength?: number) => {
      // Always reset file token limit
      if (isFileTokenLimitExceeded) {
        setIsFileTokenLimitExceeded(false);
      }

      // Only reset message token limit if message is short
      // (likely the token issue was from files, not message)
      if (
        isMessageTokenLimitExceeded &&
        (messageLength === undefined || messageLength < 1000)
      ) {
        setIsMessageTokenLimitExceeded(false);
      }
    },
    [isFileTokenLimitExceeded, isMessageTokenLimitExceeded],
  );

  // Intelligent reset when a specific file is removed
  const resetTokenLimitsOnFileRemoval = useCallback(
    (remainingFilesCount: number, messageLength: number) => {
      // If this was the last file, reset token limits
      if (remainingFilesCount === 0) {
        resetTokenLimits(messageLength);
      }
    },
    [resetTokenLimits],
  );

  return {
    // States
    isMessageTokenLimitExceeded,
    isFileTokenLimitExceeded,
    isAnyTokenLimitExceeded,

    // Handlers
    handleMessageTokenLimitExceeded,
    handleFileTokenLimitExceeded,

    // Reset utilities
    resetTokenLimits,
    resetTokenLimitsOnFileRemoval,
  };
};
