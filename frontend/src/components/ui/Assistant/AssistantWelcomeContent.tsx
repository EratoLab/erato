import Markdown from "react-markdown";

import { useChatInputControls } from "@/components/ui/Chat/ChatInputControlsContext";
import { DefaultStarterPromptsSection } from "@/components/ui/Chat/StarterPromptsSection";
import { welcomeMarkdownComponents } from "@/components/ui/WelcomeScreen";
import {
  componentRegistry,
  resolveComponentOverride,
} from "@/config/componentRegistry";

import type { AssistantWithFiles } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export function AssistantWelcomeContent({
  assistant,
}: {
  assistant: Pick<AssistantWithFiles, "welcome_message" | "starter_prompts">;
}) {
  const { setDraftMessage, focusInput } = useChatInputControls();
  const Renderer = resolveComponentOverride(
    componentRegistry.StarterPrompts,
    DefaultStarterPromptsSection,
  );
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Tolerate cached assistant responses from before welcome content was introduced.
  const prompts = assistant.starter_prompts ?? [];
  if (!assistant.welcome_message && prompts.length === 0) return null;
  return (
    <div className="mb-6 w-full space-y-4 text-base text-theme-fg-muted">
      {assistant.welcome_message && (
        <Markdown components={welcomeMarkdownComponents}>
          {assistant.welcome_message}
        </Markdown>
      )}
      {prompts.length > 0 && (
        <Renderer
          starterPrompts={prompts.map((item, index) => ({
            id: String(index),
            title: item.name,
            resolvedTitle: item.name,
            subtitle: "",
            resolvedSubtitle: "",
            prompt: item.prompt,
          }))}
          onStarterPromptSelect={(item) => {
            setDraftMessage(item.prompt, { focus: false });
            focusInput();
          }}
        />
      )}
    </div>
  );
}
