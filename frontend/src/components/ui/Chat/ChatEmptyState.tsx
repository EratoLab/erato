import { AssistantWelcomeScreen } from "@/components/ui/Assistant/AssistantWelcomeScreen";
import { WelcomeScreen } from "@/components/ui/WelcomeScreen";
import {
  componentRegistry,
  resolveComponentOverride,
} from "@/config/componentRegistry";

import type { AssistantWithFiles } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatSession } from "@/types/chat";

type BaseEmptyStateProps = {
  className?: string;
};

type ChatEmptyStateProps =
  | (BaseEmptyStateProps & {
      variant: "chat";
    })
  | (BaseEmptyStateProps & {
      variant: "assistant";
      assistant: AssistantWithFiles;
      pastChats?: ChatSession[];
      isLoadingChats?: boolean;
    });

export function ChatEmptyState(props: ChatEmptyStateProps) {
  if (props.variant === "assistant") {
    const AssistantWelcomeScreenComponent = resolveComponentOverride(
      componentRegistry.AssistantWelcomeScreen,
      AssistantWelcomeScreen,
    );

    return (
      <AssistantWelcomeScreenComponent
        assistant={props.assistant}
        pastChats={props.pastChats}
        isLoadingChats={props.isLoadingChats}
        className={props.className}
      />
    );
  }

  const ChatWelcomeScreen = resolveComponentOverride(
    componentRegistry.ChatWelcomeScreen,
    WelcomeScreen,
  );

  return <ChatWelcomeScreen className={props.className} />;
}
