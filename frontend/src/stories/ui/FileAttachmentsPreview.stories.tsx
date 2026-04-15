import { Alert } from "../../components/ui/Feedback/Alert";
import { FileAttachmentsPreview } from "../../components/ui/FileUpload/FileAttachmentsPreview";

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
