import { memo } from "react";
import { useNavigate } from "react-router-dom";

import { useFrequentAssistants } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { createLogger } from "@/utils/debugLogger";

import { InteractiveContainer } from "../Container/InteractiveContainer";

const logger = createLogger("UI", "FrequentAssistantsList");

export interface FrequentAssistantsListProps {
  /** Callback when an assistant is clicked to start a new chat */
  onAssistantSelect?: (assistantId: string) => void;
  /** Maximum number of assistants to display */
  limit?: number;
  /** Whether to render a divider after the list content */
  showBottomDivider?: boolean;
}

const AssistantItem = memo<{
  name: string;
  onSelect: () => void;
}>(({ name, onSelect }) => (
  <div className="px-2 py-1">
    <InteractiveContainer
      useDiv={true}
      onClick={onSelect}
      className="flex items-center gap-3 rounded-lg px-3 py-2 pl-10 text-left hover:bg-theme-bg-hover"
    >
      <span
        className="flex-1 truncate font-medium text-theme-fg-primary"
        title={name}
      >
        {name}
      </span>
    </InteractiveContainer>
  </div>
));

// eslint-disable-next-line lingui/no-unlocalized-strings
AssistantItem.displayName = "AssistantItem";

/**
 * FrequentAssistantsList component
 *
 * Displays frequently used assistants in the sidebar.
 * Clicking an assistant starts a new chat with that assistant's configuration.
 */
export const FrequentAssistantsList = memo<FrequentAssistantsListProps>(
  ({ onAssistantSelect, limit = 5, showBottomDivider = false }) => {
    const navigate = useNavigate();

    // Fetch frequent assistants
    const { data, isLoading, error } = useFrequentAssistants({
      queryParams: { limit },
    });

    const assistants = data?.assistants ?? [];

    // Handle assistant click - navigate to assistant's chat space
    const handleAssistantClick = (assistantId: string) => {
      logger.log(
        "[ASSISTANTS_FLOW] Assistant clicked, navigating to chat space:",
        assistantId,
      );
      if (onAssistantSelect) {
        onAssistantSelect(assistantId);
        return;
      }
      navigate(`/a/${assistantId}`);
    };

    // Don't render section if loading failed
    if (error) {
      return null;
    }

    // If there is no content, render nothing (prevents extra separators)
    const hasVisibleContent = isLoading || assistants.length > 0;
    if (!hasVisibleContent) {
      return null;
    }

    return (
      <>
        {/* Loading state */}
        {isLoading && (
          <div className="flex justify-center px-2 py-4">
            <div className="size-5 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
          </div>
        )}

        {/* Assistants list - only show if we have assistants */}
        {!isLoading && assistants.length > 0 && (
          <>
            {assistants.map((assistant) => (
              <AssistantItem
                key={assistant.id}
                name={assistant.name}
                onSelect={() => handleAssistantClick(assistant.id)}
              />
            ))}
          </>
        )}

        {showBottomDivider && (
          <div className="mx-2 my-1 border-t border-theme-border transition-opacity duration-200" />
        )}
      </>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
FrequentAssistantsList.displayName = "FrequentAssistantsList";
