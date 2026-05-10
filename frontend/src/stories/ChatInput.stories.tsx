import { action } from "@storybook/addon-actions";

import { ChatInput } from "../components/ui/Chat/ChatInput";
import { ChatProvider } from "../providers/ChatProvider";
import { StaticFeatureConfigProvider } from "../providers/FeatureConfigProvider";
import { FileCapabilitiesProvider } from "../providers/FileCapabilitiesProvider";

import type {
  FileCapability,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Meta, StoryObj } from "@storybook/react";

// export const WithCustomTheme: Story = {
//   parameters: {
//     themes: {
//       theme: 'dark', // or 'light'
//     },
//   },
// };

const meta: Meta<typeof ChatInput> = {
  title: "UI/ChatInput",
  component: ChatInput,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: "ChatGPT-style input with controls and responsive design",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    onSendMessage: { action: "message sent" },
    handleFileAttachments: {
      action: "handle file attachments",
      description: "Callback when files are added",
    },
    onRegenerate: { action: "regenerate" },
    isLoading: { control: "boolean" },
    disabled: { control: "boolean" },
    showControls: { control: "boolean" },
    acceptedFileTypes: { control: "text" },
  },
  decorators: [
    (Story) => (
      <FileCapabilitiesProvider>
        <ChatProvider>
          <div className="flex h-screen w-full items-center justify-center bg-theme-bg-primary p-0">
            <div className="flex size-full items-center justify-center rounded-lg bg-theme-bg-tertiary p-4 shadow-lg md:w-4/5 lg:w-3/4 xl:w-2/3">
              <div className="w-full max-w-full">
                <Story />
              </div>
            </div>
          </div>
        </ChatProvider>
      </FileCapabilitiesProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

const defaultArgs = {
  onSendMessage: action("onSendMessage"),
};

const documentCapability: FileCapability = {
  id: "pdf",
  extensions: ["pdf"],
  mime_types: ["application/pdf"],
  operations: ["extract_text"],
};

const longFilenameInitialFiles: FileUploadItem[] = [
  {
    id: "file-1",
    filename:
      "FY2026-enterprise-rollout-supporting-documentation-and-implementation-notes-final-review-v12.pdf",
    download_url: "https://example.com/file-1",
    file_contents_unavailable_missing_permissions: false,
    file_capability: documentCapability,
  },
  {
    id: "file-2",
    filename: "quarterly-summary.xlsx",
    download_url: "https://example.com/file-2",
    file_contents_unavailable_missing_permissions: false,
    file_capability: documentCapability,
  },
];

export const Default: Story = {
  args: {
    onSendMessage: action("message sent"),
    showControls: true,
    handleFileAttachments: action("handle file attachments"),
    onRegenerate: action("regenerate"),
    showFileTypes: true,
    initialFiles: [] as FileUploadItem[],
  },
  parameters: {
    viewport: {
      defaultViewport: "desktop",
    },
  },
};

export const Loading: Story = {
  args: {
    onSendMessage: action("message sent"),
    isLoading: true,
    showControls: true,
    handleFileAttachments: action("handle file attachments"),
    onRegenerate: action("regenerate"),
    showFileTypes: true,
    initialFiles: [] as FileUploadItem[],
  },
};

export const WithInitialAttachments: Story = {
  args: {
    onSendMessage: action("message sent"),
    showControls: true,
    handleFileAttachments: action("handle file attachments"),
    onRegenerate: action("regenerate"),
    showFileTypes: true,
    initialFiles: longFilenameInitialFiles,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Shows the real chat-input layout where uploaded attachments render above the textarea and can use the full input width.",
      },
    },
  },
};

export const WithoutControls: Story = {
  args: {
    onSendMessage: action("message sent"),
    showControls: false,
  },
};

export const WithCustomPlaceholder: Story = {
  args: {
    placeholder: "Ask me anything...",
    ...defaultArgs,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    ...defaultArgs,
  },
};

export const WithCustomClassName: Story = {
  args: {
    className: "bg-gray-100",
    ...defaultArgs,
  },
};

export const Mobile: Story = {
  args: {
    onSendMessage: action("message sent"),
    showControls: true,
    handleFileAttachments: action("handle file attachments"),
    onRegenerate: action("regenerate"),
    showFileTypes: true,
    initialFiles: [] as FileUploadItem[],
  },
  parameters: {
    viewport: {
      defaultViewport: "mobile",
    },
  },
};

export const Tablet: Story = {
  args: {
    onSendMessage: action("message sent"),
    showControls: true,
    handleFileAttachments: action("handle file attachments"),
    onRegenerate: action("regenerate"),
    showFileTypes: true,
    initialFiles: [] as FileUploadItem[],
  },
  parameters: {
    viewport: {
      defaultViewport: "tablet",
    },
  },
};

/**
 * Audio-mode story — overrides the global FeatureConfig so the empty input
 * shows the new static-waveform audio-mode button. Type into the textarea
 * to flip the slot back to the regular send button; clear it to flip back.
 *
 * The recording flow itself can't be exercised here because the backend
 * WebSocket isn't reachable from Storybook — see the standalone
 * `ChatInput/AudioModeButton` stories for the recording visual.
 */
export const AudioModeEnabled: Story = {
  args: {
    onSendMessage: action("message sent"),
    showControls: true,
    handleFileAttachments: action("handle file attachments"),
    onRegenerate: action("regenerate"),
    showFileTypes: true,
    initialFiles: [] as FileUploadItem[],
  },
  decorators: [
    (Story) => (
      <StaticFeatureConfigProvider
        config={{
          upload: { enabled: true },
          chatInput: { autofocus: false, showUsageAdvisory: false },
          audioTranscription: {
            enabled: true,
            maxRecordingDurationSeconds: 1200,
          },
          audioDictation: {
            enabled: false,
            maxRecordingDurationSeconds: 1200,
          },
        }}
      >
        <Story />
      </StaticFeatureConfigProvider>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story:
          "Compose mode with audio transcription enabled. Empty input shows the static-waveform 'audio mode' button in the send slot; typing flips it back to the send button.",
      },
    },
  },
};

/**
 * Both audio features enabled — the dictation microphone button and the
 * audio-mode waveform button live side by side. They are mutually
 * exclusive at runtime: starting dictation disables the audio-mode button
 * and vice versa.
 */
export const AudioModeAndDictationEnabled: Story = {
  args: {
    onSendMessage: action("message sent"),
    showControls: true,
    handleFileAttachments: action("handle file attachments"),
    onRegenerate: action("regenerate"),
    showFileTypes: true,
    initialFiles: [] as FileUploadItem[],
  },
  decorators: [
    (Story) => (
      <StaticFeatureConfigProvider
        config={{
          upload: { enabled: true },
          chatInput: { autofocus: false, showUsageAdvisory: false },
          audioTranscription: {
            enabled: true,
            maxRecordingDurationSeconds: 1200,
          },
          audioDictation: {
            enabled: true,
            maxRecordingDurationSeconds: 1200,
          },
        }}
      >
        <Story />
      </StaticFeatureConfigProvider>
    ),
  ],
};
