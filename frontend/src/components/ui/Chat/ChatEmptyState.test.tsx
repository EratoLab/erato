import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { componentRegistry } from "@/config/componentRegistry";

import { ChatEmptyState } from "./ChatEmptyState";

import type { AssistantWithFiles } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatSession } from "@/types/chat";

vi.mock("@/components/ui/WelcomeScreen", () => ({
  WelcomeScreenUpper: ({ className }: { className?: string }) => (
    <div data-testid="welcome-upper" className={className} />
  ),
  WelcomeScreenLower: ({ className }: { className?: string }) => (
    <div data-testid="welcome-lower" className={className} />
  ),
}));

vi.mock("@/components/ui/Assistant/AssistantWelcomeScreen", () => ({
  AssistantWelcomeUpper: ({ className }: { className?: string }) => (
    <div data-testid="assistant-upper" className={className} />
  ),
  AssistantWelcomeLower: ({
    className,
    pastChats,
  }: {
    className?: string;
    pastChats?: ChatSession[];
  }) => (
    <div data-testid="assistant-lower" className={className}>
      {pastChats?.length ?? 0}
    </div>
  ),
}));

const assistant: AssistantWithFiles = {
  id: "assistant-1",
  name: "Budget Assistant",
  description: "Helps with finance questions",
  prompt: "Use the supplied policy docs to answer questions.",
  created_at: "2026-03-23T08:00:00.000Z",
  facet_ids: [],
  enforce_facet_settings: false,
  mcp_server_ids: [],
  updated_at: "2026-03-23T09:00:00.000Z",
  files: [],
  can_edit: false,
};

const pastChats: ChatSession[] = [
  {
    id: "chat-1",
    title: "chat-1",
    updatedAt: "2026-03-23T09:00:00.000Z",
    messages: [],
  },
];

describe("ChatEmptyState", () => {
  const previous = {
    chat: componentRegistry.ChatWelcomeScreen,
    assistant: componentRegistry.AssistantWelcomeScreen,
  };

  beforeEach(() => {
    componentRegistry.ChatWelcomeScreen = null;
    componentRegistry.AssistantWelcomeScreen = null;
  });

  afterEach(() => {
    componentRegistry.ChatWelcomeScreen = previous.chat;
    componentRegistry.AssistantWelcomeScreen = previous.assistant;
  });

  describe("chat variant", () => {
    it("renders the built-in upper part by default", () => {
      render(<ChatEmptyState variant="chat" className="mt-2" />);

      expect(screen.getByTestId("welcome-upper")).toHaveClass("mt-2");
      expect(screen.queryByTestId("welcome-lower")).toBeNull();
    });

    it("renders the built-in lower part for part=lower", () => {
      render(<ChatEmptyState variant="chat" part="lower" className="mt-2" />);

      expect(screen.getByTestId("welcome-lower")).toHaveClass("mt-2");
      expect(screen.queryByTestId("welcome-upper")).toBeNull();
    });

    it("renders a registered override once, in the upper part only", () => {
      const Override = vi.fn(({ className }: { className?: string }) => (
        <div data-testid="welcome-override" className={className} />
      ));
      componentRegistry.ChatWelcomeScreen = Override;

      const { container } = render(
        <>
          <ChatEmptyState variant="chat" part="upper" className="mt-2" />
          <ChatEmptyState variant="chat" part="lower" className="mt-2" />
        </>,
      );

      expect(Override).toHaveBeenCalledTimes(1);
      expect(Override.mock.calls[0][0]).toEqual({ className: "mt-2" });
      expect(screen.getByTestId("welcome-override")).toHaveClass("mt-2");
      expect(container.querySelectorAll("[data-testid]")).toHaveLength(1);
    });
  });

  describe("assistant variant", () => {
    const props = {
      variant: "assistant" as const,
      assistant,
      pastChats,
      delegationEnabled: true,
      pinnedChatsCount: 1,
      pinnedChatsLimit: 5,
      className: "mt-2",
    };

    it("renders the built-in upper part by default", () => {
      render(<ChatEmptyState {...props} />);

      expect(screen.getByTestId("assistant-upper")).toHaveClass("mt-2");
      expect(screen.queryByTestId("assistant-lower")).toBeNull();
    });

    it("hands the conversation props to the built-in lower part", () => {
      render(<ChatEmptyState {...props} part="lower" />);

      expect(screen.getByTestId("assistant-lower")).toHaveTextContent("1");
      expect(screen.queryByTestId("assistant-upper")).toBeNull();
    });

    it("renders a registered override once with the full prop set", () => {
      const onChatPin = vi.fn();
      const Override = vi.fn(({ className }: { className?: string }) => (
        <div data-testid="assistant-override" className={className} />
      ));
      componentRegistry.AssistantWelcomeScreen = Override;

      const { container } = render(
        <>
          <ChatEmptyState {...props} part="upper" onChatPin={onChatPin} />
          <ChatEmptyState {...props} part="lower" onChatPin={onChatPin} />
        </>,
      );

      expect(Override).toHaveBeenCalledTimes(1);
      expect(Override.mock.calls[0][0]).toEqual({
        assistant,
        pastChats,
        delegatedRuns: undefined,
        delegationEnabled: true,
        isLoadingChats: undefined,
        onChatPin,
        pinnedChatsCount: 1,
        pinnedChatsLimit: 5,
        className: "mt-2",
      });
      expect(container.querySelectorAll("[data-testid]")).toHaveLength(1);
    });
  });
});
