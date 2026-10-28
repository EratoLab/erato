import { action } from "@storybook/addon-actions";

import { Alert } from "../../components/ui/Feedback/Alert";
import { FileAttachmentsPreview } from "../../components/ui/FileUpload/FileAttachmentsPreview";
import { recordingFile } from "../helpers/audioRecordingFiles";

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
];

/* Every phase a staged recording reports, on its own tile. The composer
   offers the retry only for recordings it still holds; here every failed one. */
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
