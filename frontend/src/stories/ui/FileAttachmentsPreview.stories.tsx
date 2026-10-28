import { action } from "@storybook/addon-actions";
import { useEffect, useState } from "react";

import { Alert } from "../../components/ui/Feedback/Alert";
import { FileAttachmentsPreview } from "../../components/ui/FileUpload/FileAttachmentsPreview";
import {
  AUDIO_STORY_PARTIAL_TRANSCRIPT,
  recordingFile,
  uploadedAudioFile,
} from "../helpers/audioRecordingFiles";

import type {
  FileCapability,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Meta, StoryObj } from "@storybook/react";

const longFilename =
  "FY2026-enterprise-rollout-supporting-documentation-and-implementation-notes-final-review-v12.pdf";

const documentCapability: FileCapability = {
  id: "pdf",
  extensions: ["pdf"],
  mime_types: ["application/pdf"],
  operations: ["extract_text"],
};

const attachedFiles: FileUploadItem[] = [
  {
    id: "file-1",
    filename: longFilename,
    download_url: "https://example.com/file-1",
    file_contents_unavailable_missing_permissions: false,
    is_sharepoint_file: false,
    file_capability: documentCapability,
  },
  {
    id: "file-2",
    filename: "quarterly-summary.xlsx",
    download_url: "https://example.com/file-2",
    file_contents_unavailable_missing_permissions: false,
    is_sharepoint_file: false,
    file_capability: documentCapability,
  },
];

const meta = {
  title: "UI/FileAttachmentsPreview",
  component: FileAttachmentsPreview,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Preview chips for uploaded files. These stories focus on long filenames in the same width budget used by the chat input.",
      },
    },
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="bg-theme-bg-primary p-6">
        <div className="mx-auto max-w-[720px] rounded-lg bg-theme-bg-secondary p-4">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof FileAttachmentsPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LongFilenameWithoutWarning: Story = {
  args: {
    attachedFiles,
    maxFiles: 5,
    onRemoveFile: () => {},
    onRemoveAllFiles: () => {},
    showFileTypes: true,
  },
};

export const LongFilenameWithWarning: Story = {
  render: (args) => (
    <div>
      <Alert type="warning" title="Approaching Token Limit" className="mb-2">
        This message is using 85% of the available token limit. File attachments
        account for a large share of the context.
      </Alert>
      <FileAttachmentsPreview {...args} />
    </div>
  ),
  args: {
    attachedFiles,
    maxFiles: 5,
    onRemoveFile: () => {},
    onRemoveAllFiles: () => {},
    showFileTypes: true,
  },
};

/* Teams shows a transcript's files in its own card; the count still reads
   every staged file against the limit. */
export const CountsFilesShownElsewhere: Story = {
  args: {
    attachedFiles: [
      ...attachedFiles,
      {
        id: "file-3",
        filename: "roadmap.docx",
        download_url: "https://example.com/file-3",
        file_contents_unavailable_missing_permissions: false,
        is_sharepoint_file: false,
        file_capability: documentCapability,
      },
    ],
    stagedCount: 5,
    maxFiles: 5,
    onRemoveFile: () => {},
    onRemoveAllFiles: () => {},
  },
};

const recordings = [
  recordingFile("rec-recording", "recording", "audio-recording-0901.wav"),
  recordingFile("rec-uploading", "uploading", "audio-recording-0902.wav"),
  recordingFile("rec-transcribing", "transcribing", "audio-recording-0903.wav"),
  recordingFile("rec-completed", "completed", "audio-recording-0904.wav"),
  recordingFile("rec-failed", "failed", "audio-recording-0905.wav"),
  recordingFile("rec-retrying", "failed", "audio-recording-0906.wav"),
  recordingFile("rec-canceled", "canceled", "audio-recording-0907.wav"),
  recordingFile("rec-speaking", "speaking", "audio-recording-0908.wav"),
  recordingFile("rec-stopped", "stopped", "audio-recording-0909.wav"),
  uploadedAudioFile("upload-interview", "customer-interview.wav"),
];

/* Every phase a staged recording reports, on its own tile. The composer
   offers the retry only for recordings it still holds; here every failed one.
   The composer's recordings show their latest words instead of their generated
   name; the uploaded interview keeps its name. */
export const AudioStatuses: Story = {
  args: {
    attachedFiles: recordings,
    maxFiles: 10,
    onRemoveFile: () => {},
    onRemoveAllFiles: () => {},
    onFilePreview: () => {},
    audioTranscription: {
      canRetry: (fileId) => fileId.startsWith("rec-"),
      retryingFileId: "rec-retrying",
      onRetry: action("retry transcription"),
      disabled: false,
      cancelable: true,
    },
  },
};

const LIVE_START_MS = 26_000;
const FIRST_CHUNK_MS = 30_000;

/** A recording that runs: the composer's clock ticks it up every second, and the first chunk's words arrive at 0:30. */
const LiveRecording = () => {
  const [elapsedMs, setElapsedMs] = useState(LIVE_START_MS);
  useEffect(() => {
    const timer = window.setInterval(
      () => setElapsedMs((current) => current + 1000),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const spoken = elapsedMs >= FIRST_CHUNK_MS;
  const file = recordingFile("rec-live", "recording");
  return (
    <FileAttachmentsPreview
      attachedFiles={[
        {
          ...file,
          audio_transcription: {
            status: "recording",
            ...(spoken ? { transcript: AUDIO_STORY_PARTIAL_TRANSCRIPT } : {}),
            chunks: spoken
              ? [
                  {
                    index: 0,
                    status: "completed",
                    end_ms: FIRST_CHUNK_MS,
                    transcript: AUDIO_STORY_PARTIAL_TRANSCRIPT,
                  },
                ]
              : [],
            recording_elapsed_ms: elapsedMs,
          } as unknown as FileUploadItem["audio_transcription"],
        },
      ]}
      maxFiles={10}
      onRemoveFile={() => {}}
      onRemoveAllFiles={() => {}}
      onFilePreview={action("preview")}
      audioTranscription={{
        canRetry: () => false,
        retryingFileId: null,
        onRetry: action("retry transcription"),
        disabled: false,
        cancelable: true,
      }}
    />
  );
};

/* The running recording counts up every second by the composer's own clock,
   not in the 30-second steps of the chunks the server has taken up. */
export const AudioRecordingLive: Story = {
  args: {
    attachedFiles: [],
    maxFiles: 10,
    onRemoveFile: () => {},
    onRemoveAllFiles: () => {},
  },
  render: () => <LiveRecording />,
};
