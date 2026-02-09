/**
 * WelcomeScreens - Example Customer Overrides
 *
 * This file shows lightweight overrides for the chat and assistant
 * welcome/empty state components.
 *
 * To use this:
 * 1. Copy this file to: src/customer/components/WelcomeScreens.tsx
 * 2. Update src/config/componentRegistry.ts to import and use it
 *
 * @example
 * // In componentRegistry.ts:
 * import {
 *   WelcomeScreen,
 *   AssistantWelcomeScreen,
 * } from "@/customer/components/WelcomeScreens";
 *
 * export const componentRegistry: ComponentRegistry = {
 *   ChatWelcomeScreen: WelcomeScreen,
 *   AssistantWelcomeScreen: AssistantWelcomeScreen,
 * };
 */
import { useChatInputControls } from "@/components/ui/Chat/ChatInputControlsContext";
import { Button } from "@/components/ui/Controls/Button";

import type { AssistantWelcomeScreenProps } from "@/components/ui/Assistant/AssistantWelcomeScreen";
import type { WelcomeScreenProps } from "@/components/ui/WelcomeScreen";

const PROMPT_TEMPLATE = "What do you know about our products?";

// Example uses "web_search" to align with common default facet ids.
const TOOL_A_FACET_ID = "web_search";

const ExampleActions = ({ className = "" }: { className?: string }) => {
  const { setDraftMessage, setSelectedFacetIds, focusInput } =
    useChatInputControls();

  const handlePromptTemplate = () => {
    setDraftMessage(PROMPT_TEMPLATE, { focus: true });
  };

  const handleToolSelection = () => {
    const resolvedFacetId =
      typeof window !== "undefined" && window.__E2E_FACET_ID__
        ? window.__E2E_FACET_ID__
        : TOOL_A_FACET_ID;
    if (!resolvedFacetId) {
      return;
    }
    setSelectedFacetIds([resolvedFacetId]);
    focusInput();
  };

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={handlePromptTemplate}
        data-testid="welcome-screen-template-button"
      >
        {PROMPT_TEMPLATE}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleToolSelection}
        data-testid="welcome-screen-tool-a-button"
      >
        Check Tool A
      </Button>
    </div>
  );
};

export function WelcomeScreen({ className = "" }: WelcomeScreenProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-4 p-10 text-center ${className}`}
      data-testid="welcome-screen-example"
    >
      <div className="text-3xl font-semibold text-theme-fg-primary">
        Welcome to your custom chat
      </div>
      <p className="max-w-md text-sm text-theme-fg-secondary">
        This empty state is fully replaceable via componentRegistry.
      </p>
      <ExampleActions className="mt-2" />
    </div>
  );
}

export function AssistantWelcomeScreen({
  assistant,
  className = "",
}: AssistantWelcomeScreenProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 p-10 text-center ${className}`}
      data-testid="assistant-welcome-screen-example"
    >
      <div className="text-xl font-semibold text-theme-fg-primary">
        Custom assistant home
      </div>
      <p className="text-sm text-theme-fg-secondary">
        You are chatting with:{" "}
        <span className="font-medium text-theme-fg-primary">
          {assistant.name}
        </span>
      </p>
      <ExampleActions className="mt-2" />
    </div>
  );
}
