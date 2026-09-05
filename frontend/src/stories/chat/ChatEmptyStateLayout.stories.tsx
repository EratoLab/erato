import { action } from "@storybook/addon-actions";

import { ChatEmptyStateLayout } from "../../components/ui/Chat/ChatEmptyStateLayout";
import { ChatInput } from "../../components/ui/Chat/ChatInput";
import { ChatInputControlsProvider } from "../../components/ui/Chat/ChatInputControlsContext";
import { ChatUsageAdvisory } from "../../components/ui/Chat/ChatUsageAdvisory";
import { WelcomeScreen } from "../../components/ui/WelcomeScreen";
import { StaticFeatureConfigProvider } from "../../providers/FeatureConfigProvider";

import type { ChatInputControls } from "../../components/ui/Chat/ChatInputControlsContext";
import type { Meta, StoryObj } from "@storybook/react";

const stubControls: ChatInputControls = {
  setDraftMessage: action("setDraftMessage"),
  focusInput: action("focusInput"),
  setSelectedFacetIds: action("setSelectedFacetIds"),
  setSelectedChatProviderId: action("setSelectedChatProviderId"),
  toggleFacetId: action("toggleFacetId"),
  addUploadedFiles: action("addUploadedFiles"),
  clearQueuedMessage: action("clearQueuedMessage"),
};

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
      <StaticFeatureConfigProvider
        config={{
          chatInput: { autofocus: false },
          starterPrompts: { enabled: false },
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

export const CenteredDefault: Story = {
  args: {
    mode: "centered",
    above: <WelcomeScreen />,
    composer,
    below: <ChatUsageAdvisory />,
  },
};

export const CenteredLongContent: Story = {
  args: {
    mode: "centered",
    above: (
      <>
        <WelcomeScreen />
        {extraParagraphs}
      </>
    ),
    composer,
    below: (
      <>
        <ChatUsageAdvisory />
        {tallBlock}
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
    above: <WelcomeScreen />,
    composer,
    below: <ChatUsageAdvisory />,
  },
};

export const BottomLongContent: Story = {
  args: {
    mode: "bottom",
    above: (
      <>
        <WelcomeScreen />
        {extraParagraphs}
      </>
    ),
    composer,
    below: <ChatUsageAdvisory />,
  },
};
