import { t } from "@lingui/core/macro";
import { memo } from "react";
import { useNavigate } from "react-router-dom";

import { InteractiveContainer } from "../Container/InteractiveContainer";
import { EditIcon } from "../icons";
import { useFrequentAssistants } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { createLogger } from "@/utils/debugLogger";

const logger = createLogger("UI", "FrequentAssistantsList");

export interface FrequentAssistantsListProps {
  /** Callback when an assistant is clicked to start a new chat */
  onAssistantSelect?: (assistantId: string) => void;
  /** Maximum number of assistants to display */
  limit?: number;
}

const AssistantItem = memo<{
  assistantId: string;
  name: string;
  onSelect: () => void;
}>(({ name, onSelect }) => (
  <div className="px-2 py-1">
    <InteractiveContainer
      useDiv={true}
      onClick={onSelect}
      className="flex items-center gap-3 rounded-lg px-3 py-2 pl-10 text-left hover:bg-theme-bg-hover"
    >
      <span className="flex-1 truncate font-medium text-theme-fg-primary" title={name}>
        {name}
      </span>
    </InteractiveContainer>
  </div>
));

// eslint-disable-next-line lingui/no-unlocalized-strings
AssistantItem.displayName = "AssistantItem";

const AssistantsNavigationItem = memo<{
  onNavigate: () => void;
}>(({ onNavigate }) => (
  <div className="px-2 py-1">
    <a
      href="/assistants"
      onClick={(e) => {
        // Allow cmd/ctrl-click to open in new tab
        if (e.metaKey || e.ctrlKey) {
          return;
        }
        // Prevent default navigation for normal clicks
        e.preventDefault();
        logger.log("[ASSISTANTS_FLOW] Assistants navigation clicked in sidebar");
        onNavigate();
      }}
      className="block"
      aria-label={t`View all assistants`}
    >
      <InteractiveContainer
        useDiv={true}
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-theme-bg-hover"
      >
        <EditIcon className="size-4 text-theme-fg-secondary" />
        <span className="font-medium text-theme-fg-primary">{t`Assistants`}</span>
      </InteractiveContainer>
    </a>
  </div>
));

// eslint-disable-next-line lingui/no-unlocalized-strings
AssistantsNavigationItem.displayName = "AssistantsNavigationItem";

/**
 * FrequentAssistantsList component
 * 
 * Displays frequently used assistants in the sidebar.
 * Clicking an assistant starts a new chat with that assistant's configuration.
 * The section header navigates to the full assistants list page.
 */
export const FrequentAssistantsList = memo<FrequentAssistantsListProps>(
  ({ onAssistantSelect, limit = 5 }) => {
    const navigate = useNavigate();
    
    // Fetch frequent assistants
    const { data, isLoading, error } = useFrequentAssistants({
      queryParams: { limit },
    });

    const assistants = data?.assistants ?? [];

    // Handle header click - navigate to full assistants page
    const handleNavigateToAssistants = () => {
      logger.log("[ASSISTANTS_FLOW] Navigating to assistants page");
      navigate("/assistants");
    };

    // Handle assistant click
    const handleAssistantClick = (assistantId: string) => {
      logger.log("[ASSISTANTS_FLOW] Assistant clicked:", assistantId);
      if (onAssistantSelect) {
        onAssistantSelect(assistantId);
      }
    };

    // Don't render section if loading failed
    if (error) {
      return null;
    }

    return (
      <>
        {/* Navigation item - always show so users can navigate to assistants page */}
        <AssistantsNavigationItem onNavigate={handleNavigateToAssistants} />

        {/* Loading state */}
        {isLoading && (
          <div className="flex justify-center py-4 px-2">
            <div className="size-5 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
          </div>
        )}

        {/* Assistants list - only show if we have assistants */}
        {!isLoading && assistants.length > 0 && (
          <>
            {assistants.map((assistant) => (
              <AssistantItem
                key={assistant.id}
                assistantId={assistant.id}
                name={assistant.name}
                onSelect={() => handleAssistantClick(assistant.id)}
              />
            ))}
          </>
        )}
      </>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
FrequentAssistantsList.displayName = "FrequentAssistantsList";

