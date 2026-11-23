import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { VoiceOutputSetting } from "@/components/ui/Settings/VoiceOutputSetting";
import {
  approvalSpeechStyleQuery,
  replySpeechStyleQuery,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type {
  ApprovalSpeechStyleResponse,
  ReplySpeechStyleResponse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Meta, StoryObj } from "@storybook/react";

const REPLIES: ReplySpeechStyleResponse = {
  spoken: true,
  spoken_source: "deployment",
  wording: "natural",
  source: "deployment",
  user_choice: true,
  show_in_chat: false,
  show_in_chat_source: "deployment",
};

const CARDS: ApprovalSpeechStyleResponse = {
  spoken: true,
  spoken_source: "deployment",
  amount: "full",
  short_details: 1,
  wording: "precise",
  source: "deployment",
  user_choice: true,
};

/** The voice section of Settings, Audio, with the resolved values seeded. */
const Seeded = ({
  replies = REPLIES,
  cards = CARDS,
}: {
  replies?: ReplySpeechStyleResponse;
  cards?: ApprovalSpeechStyleResponse;
}) => {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(replySpeechStyleQuery({}).queryKey, replies);
    client.setQueryData(approvalSpeechStyleQuery({}).queryKey, cards);
    return client;
  });
  return (
    <QueryClientProvider client={queryClient}>
      <div className="max-w-xl bg-theme-bg-primary p-6">
        <VoiceOutputSetting />
      </div>
    </QueryClientProvider>
  );
};

const meta: Meta = {
  title: "UI/Settings/VoiceOutputSetting",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "What a person hears in conversation mode, how it sounds and what the chat shows. Each row follows the deployment's default, an audience's value and the user's own choice where the organization allows it.",
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => <Seeded />,
};

export const RepliesTurnedOff: Story = {
  render: () => (
    <Seeded replies={{ ...REPLIES, spoken: false, spoken_source: "user" }} />
  ),
};

export const SetByOrganization: Story = {
  render: () => (
    <Seeded
      replies={{ ...REPLIES, user_choice: false, source: "audience" }}
      cards={{ ...CARDS, user_choice: false, spoken: false }}
    />
  ),
};
