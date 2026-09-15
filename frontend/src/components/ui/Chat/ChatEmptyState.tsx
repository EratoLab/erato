import {
  AssistantWelcomeLower,
  AssistantWelcomeUpper,
} from "@/components/ui/Assistant/AssistantWelcomeScreen";
import {
  WelcomeScreenLower,
  WelcomeScreenUpper,
} from "@/components/ui/WelcomeScreen";
import { componentRegistry } from "@/config/componentRegistry";

import type { AssistantWithFiles } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatSession } from "@/types/chat";

type BaseEmptyStateProps = {
  className?: string;
  /**
   * `ChatWelcomeScreen` and `AssistantWelcomeScreen` overrides are a whole
   * welcome: they render once in "upper" and "lower" stays empty. An
   * `AssistantWelcomeUpper` override is the hero alone, so the host keeps
   * rendering its conversation list in "lower". Registering both assistant
   * points is a kit bug; `AssistantWelcomeUpper` wins.
   */
  part?: "upper" | "lower";
};

type ChatEmptyStateProps =
  | (BaseEmptyStateProps & {
      variant: "chat";
    })
  | (BaseEmptyStateProps & {
      variant: "assistant";
      assistant: AssistantWithFiles;
      pastChats?: ChatSession[];
      delegatedRuns?: ChatSession[];
      delegationEnabled?: boolean;
      isLoadingChats?: boolean;
      onChatPin?: (chatId: string, isPinned: boolean) => void;
      pinnedChatsCount?: number;
      pinnedChatsLimit?: number;
    });

export function ChatEmptyState(props: ChatEmptyStateProps) {
  const part = props.part ?? "upper";

  if (props.variant === "assistant") {
    const assistantProps = {
      assistant: props.assistant,
      pastChats: props.pastChats,
      delegatedRuns: props.delegatedRuns,
      delegationEnabled: props.delegationEnabled,
      isLoadingChats: props.isLoadingChats,
      onChatPin: props.onChatPin,
      pinnedChatsCount: props.pinnedChatsCount,
      pinnedChatsLimit: props.pinnedChatsLimit,
      className: props.className,
    };

    const AssistantWelcomeUpperOverride =
      componentRegistry.AssistantWelcomeUpper;
    if (AssistantWelcomeUpperOverride) {
      return part === "lower" ? (
        <AssistantWelcomeLower {...assistantProps} />
      ) : (
        <AssistantWelcomeUpperOverride {...assistantProps} />
      );
    }

    const AssistantWelcomeOverride = componentRegistry.AssistantWelcomeScreen;
    if (AssistantWelcomeOverride) {
      return part === "lower" ? null : (
        <AssistantWelcomeOverride {...assistantProps} />
      );
    }

    return part === "lower" ? (
      <AssistantWelcomeLower {...assistantProps} />
    ) : (
      <AssistantWelcomeUpper
        assistant={props.assistant}
        className={props.className}
      />
    );
  }

  const ChatWelcomeOverride = componentRegistry.ChatWelcomeScreen;
  if (ChatWelcomeOverride) {
    return part === "lower" ? null : (
      <ChatWelcomeOverride className={props.className} />
    );
  }

  return part === "lower" ? (
    <WelcomeScreenLower className={props.className} />
  ) : (
    <WelcomeScreenUpper className={props.className} />
  );
}
