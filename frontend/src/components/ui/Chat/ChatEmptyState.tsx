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
   * Which side of the composer this instance fills. A registry override is a
   * whole welcome: it renders once in the upper part and leaves the lower
   * part empty, so it never gains default content it did not ask for.
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
