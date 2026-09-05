import { action } from "@storybook/addon-actions";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useRef } from "react";

import { ChatEmptyState } from "../../components/ui/Chat/ChatEmptyState";
import { ChatEmptyStateLayout } from "../../components/ui/Chat/ChatEmptyStateLayout";
import { ChatInput } from "../../components/ui/Chat/ChatInput";
import { ChatInputControlsProvider } from "../../components/ui/Chat/ChatInputControlsContext";
import { ChatUsageAdvisory } from "../../components/ui/Chat/ChatUsageAdvisory";
import { Button } from "../../components/ui/Controls/Button";
import { componentRegistry } from "../../config/componentRegistry";
import {
  facetsQuery,
  starterPromptsQuery,
} from "../../lib/generated/v1betaApi/v1betaApiComponents";
import { StaticFeatureConfigProvider } from "../../providers/FeatureConfigProvider";

import type { ChatInputControls } from "../../components/ui/Chat/ChatInputControlsContext";
import type { WelcomeScreenProps } from "../../components/ui/WelcomeScreen";
import type { AssistantWithFiles } from "../../lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatSession } from "../../types/chat";
import type { Decorator, Meta, StoryObj } from "@storybook/react";

const stubControls: ChatInputControls = {
  setDraftMessage: action("setDraftMessage"),
  focusInput: action("focusInput"),
  setSelectedFacetIds: action("setSelectedFacetIds"),
  setSelectedChatProviderId: action("setSelectedChatProviderId"),
  toggleFacetId: action("toggleFacetId"),
  addUploadedFiles: action("addUploadedFiles"),
  clearQueuedMessage: action("clearQueuedMessage"),
};

const starterPrompts = [
  {
    id: "research_topic",
    title: "Research a topic",
    subtitle: "Find sources and summarise what they say",
    prompt: "Research the following topic and summarise the key sources: ",
    icon: "search",
    selected_facets: [],
  },
  {
    id: "draft_email",
    title: "Draft an email",
    subtitle: "Write a first version you can edit",
    prompt: "Draft an email about: ",
    icon: "mail",
    selected_facets: [],
  },
  {
    id: "summarize_notes",
    title: "Summarize notes",
    subtitle: "Turn raw notes into a short summary",
    prompt: "Summarise these notes: ",
    icon: "page",
    selected_facets: [],
  },
];

// Storybook has no backend; a seeded cache keeps the composer's tools menu
// from showing its load-error banner and gives the welcome its prompts.
const makeQueryClient = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(facetsQuery({}).queryKey, {
    facets: [],
    global_facet_settings: {
      only_single_facet: false,
      show_facet_indicator_with_display_name: false,
    },
  });
  queryClient.setQueryData(starterPromptsQuery({}).queryKey, {
    starter_prompts: starterPrompts,
  });
  return queryClient;
};

const assistant: AssistantWithFiles = {
  id: "assistant-research",
  name: "Research Assistant",
  description: "Finds and summarizes sources for product and market questions.",
  prompt: "You research product and market questions and cite your sources.",
  created_at: "2026-09-01T08:00:00.000Z",
  updated_at: "2026-09-04T09:00:00.000Z",
  facet_ids: [],
  enforce_facet_settings: false,
  mcp_server_ids: [],
  files: [],
  can_edit: true,
};

const session = (
  id: string,
  title: string,
  hoursAgo: number,
  extra: Partial<ChatSession> = {},
): ChatSession => ({
  id,
  title,
  updatedAt: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
  messages: [],
  assistantId: assistant.id,
  ...extra,
});

const pastChats = [
  session("chat-1", "Competitor pricing overview", 2),
  session("chat-2", "Summarize Q3 customer interviews", 26),
  session("chat-3", "Battery supplier shortlist", 72),
  session("chat-4", "Launch announcement draft", 96),
  session("chat-5", "Onboarding checklist", 120),
  session("chat-6", "Trade show follow-ups", 150),
  session("chat-7", "Partner API comparison", 200),
];

const delegatedRuns = [
  session("run-1", "Collect pricing pages for the top five competitors", 5, {
    provenanceKind: "delegation",
    originChatId: "chat-1",
    originChatTitle: "Competitor pricing overview",
  }),
];

const LegacyWelcomeOverride = ({ className }: WelcomeScreenProps) => (
  <section
    className={clsx("mx-auto w-full max-w-2xl px-4 text-center", className)}
    data-testid="welcome-screen-example"
  >
    <p className="text-xs uppercase tracking-wide text-theme-fg-muted">
      ChatWelcomeScreen override (customer kit)
    </p>
    <div className="mx-auto mt-4 flex size-16 items-center justify-center rounded-full bg-theme-avatar-assistant-bg text-2xl font-semibold text-theme-avatar-assistant-fg">
      C
    </div>
    <h1 className="mt-3 text-2xl font-bold text-theme-fg-primary">
      Contoso Knowledge Assistant
    </h1>
    <p className="mt-2 text-theme-fg-secondary">
      Answers from the Contoso handbook and policy library. Pick a template or
      enable a tool to begin.
    </p>
    <div className="mt-4 flex justify-center gap-2">
      <Button variant="secondary" size="sm" onClick={action("template")}>
        Use email template
      </Button>
      <Button variant="ghost" size="sm" onClick={action("tool")}>
        Enable Tool A
      </Button>
    </div>
  </section>
);

// The registry is read during render, so the override has to be in place
// before the story's first render and gone again once it unmounts.
const LegacyWelcomeOverrideScope = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const previous = useRef(componentRegistry.ChatWelcomeScreen);
  componentRegistry.ChatWelcomeScreen = LegacyWelcomeOverride;
  useEffect(
    () => () => {
      componentRegistry.ChatWelcomeScreen = previous.current;
    },
    [],
  );
  return <>{children}</>;
};

const withLegacyWelcomeOverride: Decorator = (Story) => (
  <LegacyWelcomeOverrideScope>
    <Story />
  </LegacyWelcomeOverrideScope>
);

const meta: Meta<typeof ChatEmptyStateLayout> = {
  title: "Chat/EmptyStateLayout",
  component: ChatEmptyStateLayout,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The three-row frame Chat renders around the composer: welcome content above, the composer cluster, and the advisory plus supplementary content below. The story pane is a fixed-height stand-in for the chat pane.",
      },
    },
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeQueryClient()}>
        <StaticFeatureConfigProvider
          config={{
            chatInput: { autofocus: false },
            starterPrompts: { enabled: true },
          }}
        >
          <ChatInputControlsProvider value={stubControls}>
            <div
              className="flex h-screen w-full flex-col bg-theme-bg-primary"
              data-ui="story-pane"
            >
              <Story />
            </div>
          </ChatInputControlsProvider>
        </StaticFeatureConfigProvider>
      </QueryClientProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

const composer = (
  <ChatInput
    onSendMessage={action("onSendMessage")}
    showControls
    className="p-2 sm:p-4"
    renderUsageAdvisory={false}
  />
);

const extraParagraphs = (
  <div className="w-full max-w-2xl px-6 text-theme-fg-secondary">
    {Array.from({ length: 40 }, (_, index) => (
      <p key={index} className="mb-3">
        Paragraph {index + 1}: long welcome copy that keeps going so the upper
        half has more content than it can show at once.
      </p>
    ))}
  </div>
);

const tallBlock = (
  <div className="w-full max-w-2xl px-6" data-ui="story-tall-block">
    {Array.from({ length: 30 }, (_, index) => (
      <div
        key={index}
        className="mb-2 rounded-[var(--theme-radius-control)] border border-theme-border p-4 text-theme-fg-secondary"
      >
        Supplementary row {index + 1}
      </div>
    ))}
  </div>
);

const welcomeUpper = <ChatEmptyState variant="chat" part="upper" />;
const welcomeLower = <ChatEmptyState variant="chat" part="lower" />;

export const CenteredDefault: Story = {
  args: {
    mode: "centered",
    above: welcomeUpper,
    composer,
    below: (
      <>
        <ChatUsageAdvisory />
        {welcomeLower}
      </>
    ),
  },
};

export const CenteredLongContent: Story = {
  args: {
    mode: "centered",
    above: (
      <>
        {welcomeUpper}
        {extraParagraphs}
      </>
    ),
    composer,
    below: (
      <>
        <ChatUsageAdvisory />
        {welcomeLower}
        {tallBlock}
      </>
    ),
  },
};

export const CenteredAssistant: Story = {
  args: {
    mode: "centered",
    above: (
      <ChatEmptyState
        variant="assistant"
        part="upper"
        assistant={assistant}
        pastChats={pastChats}
        delegatedRuns={delegatedRuns}
        delegationEnabled
      />
    ),
    composer,
    below: (
      <>
        <ChatUsageAdvisory />
        <ChatEmptyState
          variant="assistant"
          part="lower"
          assistant={assistant}
          pastChats={pastChats}
          delegatedRuns={delegatedRuns}
          delegationEnabled
          onChatPin={action("onChatPin")}
          pinnedChatsCount={1}
          pinnedChatsLimit={5}
        />
      </>
    ),
  },
};

export const CenteredLegacyOverride: Story = {
  decorators: [withLegacyWelcomeOverride],
  args: {
    mode: "centered",
    above: welcomeUpper,
    composer,
    below: (
      <>
        <ChatUsageAdvisory />
        {welcomeLower}
      </>
    ),
  },
};

export const CenteredReadOnly: Story = {
  args: {
    mode: "centered",
    above: (
      <div className="mx-auto max-w-xl px-6 text-center text-theme-fg-secondary">
        Loading shared chat...
      </div>
    ),
    composer: null,
    below: null,
  },
};

export const BottomDefault: Story = {
  args: {
    mode: "bottom",
    above: (
      <>
        {welcomeUpper}
        {welcomeLower}
      </>
    ),
    composer,
    below: <ChatUsageAdvisory />,
  },
};

export const BottomLongContent: Story = {
  args: {
    mode: "bottom",
    above: (
      <>
        {welcomeUpper}
        {welcomeLower}
        {extraParagraphs}
      </>
    ),
    composer,
    below: <ChatUsageAdvisory />,
  },
};
