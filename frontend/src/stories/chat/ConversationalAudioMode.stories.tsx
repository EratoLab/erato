import { action } from "@storybook/addon-actions";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ChatInput } from "@/components/ui/Chat/ChatInput";
import { useApprovalSpeech } from "@/hooks/audio/approvalSpeech";
import { useSpeechPlayback } from "@/hooks/audio/speechPlayback";
import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { facetsQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import type { Meta, StoryObj } from "@storybook/react";

const CHAT_ID = "story-conversation";

type State = "off" | "speaking" | "card";

/**
 * The composer in conversation mode, with the stores set as a real turn
 * leaves them. Listening needs the recorder's backend, so it is not shown
 * here; the waveform it shows is in `UI/ChatInput/AudioModeButton`.
 */
const ConversationComposer = ({ state }: { state: State }) => {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(facetsQuery({}).queryKey, {
      facets: [],
      global_facet_settings: {
        only_single_facet: false,
        show_facet_indicator_with_display_name: false,
      },
    });
    return client;
  });
  const [ready] = useState(() => {
    useSpeechPlayback.setState({
      enabled: true,
      cards: true,
      playing: state === "speaking",
    });
    if (state === "card") {
      useConfirmationRegistryStore
        .getState()
        .registerConfirmation(CHAT_ID, "story-card");
      useApprovalSpeech.setState({
        key: "story-card",
        available: {
          key: "story-card",
          messageId: "story-message",
          language: "en",
          pieces: [],
          fallback: [],
          approval: { type: "pointer" },
        },
        speaking: false,
      });
    }
    return true;
  });
  useEffect(
    () => () => {
      useSpeechPlayback.setState({ playing: false });
      useConfirmationRegistryStore
        .getState()
        .unregisterConfirmation(CHAT_ID, "story-card");
      useApprovalSpeech.setState({ key: null, available: null });
    },
    [],
  );
  if (!ready) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-[calc(100vh-32px)] flex-col justify-end">
        <ChatInput
          chatId={CHAT_ID}
          onSendMessage={action("send")}
          showControls
          {...(state === "off"
            ? {}
            : {
                controlledIsAudioMode: true,
                onControlledIsAudioModeChange: action("audio mode"),
              })}
        />
      </div>
    </QueryClientProvider>
  );
};

const meta: Meta = {
  title: "Chat/ConversationalAudioMode",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Conversation mode adds no buttons of its own: replies are spoken and cards read aloud as the user's settings say. In the mode the audio-mode button in Send's corner ends it in every state.",
      },
    },
  },
  decorators: [
    (Story) => (
      <StaticFeatureConfigProvider
        config={{
          upload: { enabled: true },
          chatInput: { autofocus: false, showUsageAdvisory: false },
          audioDictation: { enabled: true, maxRecordingDurationSeconds: 1200 },
          audioConversational: {
            enabled: true,
            speechEnabled: true,
            maxRecordingDurationSeconds: 1200,
          },
        }}
      >
        <Story />
      </StaticFeatureConfigProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj;

export const NotInAudioMode: Story = {
  render: () => <ConversationComposer state="off" />,
};

export const VoiceSpeaking: Story = {
  render: () => <ConversationComposer state="speaking" />,
};

export const CardWaiting: Story = {
  render: () => <ConversationComposer state="card" />,
};
