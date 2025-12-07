/**
 * Cloud File Picker Storybook Stories
 *
 * Comprehensive stories demonstrating all component states
 */

import { useState } from "react";

import { CloudFilePicker } from "@/components/ui/CloudFilePicker/CloudFilePicker";

import type { SelectedCloudFile } from "@/lib/api/cloudProviders/types";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Cloud File Picker",
  component: CloudFilePicker,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: `
A provider-agnostic cloud file picker component for selecting files from cloud storage providers (Sharepoint/OneDrive, Google Drive, etc.).

## Features

- **Multiple providers**: Initially supports Sharepoint/OneDrive, extensible to Google Drive
- **Hierarchical navigation**: Browse through drives, folders, and files with breadcrumb navigation
- **File type filtering**: Show only supported file types, disable unsupported ones
- **Selection modes**: Single or multiple file selection with configurable limits
- **Responsive design**: Works on mobile and desktop
- **Accessibility**: Full keyboard navigation and ARIA labels
- **Loading states**: Skeleton loaders and empty states
- **Error handling**: Graceful error messages

## Component Architecture

The picker consists of several sub-components:
- **CloudDriveList**: Displays available drives
- **CloudItemBrowser**: Shows files and folders with selection
- **CloudNavigationBreadcrumb**: Current location breadcrumb trail
- **CloudFileTypeIcon**: File type icons based on MIME type

## Usage Example

\`\`\`tsx
import { CloudFilePicker } from '@/components/ui/CloudFilePicker/CloudFilePicker';

<CloudFilePicker
  provider="sharepoint"
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  onFilesSelected={(files) => console.log('Selected:', files)}
  multiple={true}
  maxFiles={5}
  acceptedFileTypes={['pdf', 'document']}
/>
\`\`\`

Note: The component uses auto-generated React Query hooks internally. For Storybook,
MSW handlers mock the API endpoints (see \`frontend/src/lib/mocks/handlers.ts\`).
        `,
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    provider: {
      control: "select",
      options: ["sharepoint", "googledrive"],
      description: "Cloud storage provider",
    },
    multiple: {
      control: "boolean",
      description: "Allow multiple file selection",
    },
    maxFiles: {
      control: "number",
      description: "Maximum number of files to select",
    },
    acceptedFileTypes: {
      control: "object",
      description: "Accepted file types (extensions or mime types)",
    },
  },
} satisfies Meta<typeof CloudFilePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

// Wrapper component to show the modal directly open
function PickerStory(props: React.ComponentProps<typeof CloudFilePicker>) {
  const [selectedFiles, setSelectedFiles] = useState<SelectedCloudFile[]>([]);

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      {selectedFiles.length > 0 && (
        <div className="mb-4 max-w-md rounded border border-green-200 bg-green-50 p-3">
          <p className="mb-2 font-medium text-green-800">
            Selected {selectedFiles.length} file(s):
          </p>
          <ul className="space-y-1 text-sm text-green-700">
            {selectedFiles.map((file) => (
              <li key={file.item_id}>
                • {file.name} ({file.mime_type})
              </li>
            ))}
          </ul>
        </div>
      )}

      <CloudFilePicker
        {...props}
        onFilesSelected={(files) => {
          setSelectedFiles(files);
          console.log(
            `Selected ${files.length} file(s):`,
            files.map((f) => f.name).join(", "),
          );
        }}
      />
    </div>
  );
}

/**
 * Default file picker with multiple selection enabled - showing drive list
 */
export const Default: Story = {
  render: (args) => <PickerStory {...args} />,
  args: {
    provider: "sharepoint",
    isOpen: true,
    onClose: () => console.log("Closed"),
    onFilesSelected: () => {},
    multiple: true,
    maxFiles: 5,
    acceptedFileTypes: [],
  },
};

/**
 * Single file selection mode
 */
export const SingleSelection: Story = {
  render: (args) => <PickerStory {...args} />,
  args: {
    provider: "sharepoint",
    isOpen: true,
    onClose: () => console.log("Closed"),
    onFilesSelected: () => {},
    multiple: false,
    maxFiles: 1,
    acceptedFileTypes: [],
  },
};

/**
 * Multiple selection with limit of 5 files
 */
export const MultiSelection: Story = {
  render: (args) => <PickerStory {...args} />,
  args: {
    provider: "sharepoint",
    isOpen: true,
    onClose: () => console.log("Closed"),
    onFilesSelected: () => {},
    multiple: true,
    maxFiles: 5,
    acceptedFileTypes: [],
  },
};

/**
 * File type filtering - only PDF and Word documents
 */
export const WithFileTypeFilter: Story = {
  render: (args) => <PickerStory {...args} />,
  args: {
    provider: "sharepoint",
    isOpen: true,
    onClose: () => console.log("Closed"),
    onFilesSelected: () => {},
    multiple: true,
    maxFiles: 5,
    acceptedFileTypes: ["pdf", "document"],
  },
};

/**
 * Loading state with skeleton loaders
 */
export const LoadingState: Story = {
  render: (args) => <PickerStory {...args} />,
  args: {
    provider: "sharepoint",
    isOpen: true,
    onClose: () => console.log("Closed"),
    onFilesSelected: () => {},
    multiple: true,
    maxFiles: 5,
    acceptedFileTypes: [],
  },
};

/**
 * Empty drive with no files or folders
 */
export const EmptyDrive: Story = {
  render: (args) => <PickerStory {...args} />,
  args: {
    provider: "sharepoint",
    isOpen: true,
    onClose: () => console.log("Closed"),
    onFilesSelected: () => {},
    multiple: true,
    maxFiles: 5,
    acceptedFileTypes: [],
  },
};

/**
 * Error state when API fails
 */
export const ErrorState: Story = {
  render: (args) => <PickerStory {...args} />,
  args: {
    provider: "sharepoint",
    isOpen: true,
    onClose: () => console.log("Closed"),
    onFilesSelected: () => {},
    multiple: true,
    maxFiles: 5,
    acceptedFileTypes: [],
  },
};

/**
 * Unsupported file types shown as disabled
 */
export const UnsupportedFileTypes: Story = {
  render: (args) => <PickerStory {...args} />,
  args: {
    provider: "sharepoint",
    isOpen: true,
    onClose: () => console.log("Closed"),
    onFilesSelected: () => {},
    multiple: true,
    maxFiles: 5,
    acceptedFileTypes: ["pdf", "document"],
  },
};

/**
 * Max files limit demonstration
 */
export const MaxFilesLimit: Story = {
  render: (args) => <PickerStory {...args} />,
  args: {
    provider: "sharepoint",
    isOpen: true,
    onClose: () => console.log("Closed"),
    onFilesSelected: () => {},
    multiple: true,
    maxFiles: 3,
    acceptedFileTypes: [],
  },
};

/**
 * Strict file type filter - only PDFs allowed
 */
export const StrictFileTypeFilter: Story = {
  render: (args) => <PickerStory {...args} />,
  args: {
    provider: "sharepoint",
    isOpen: true,
    onClose: () => console.log("Closed"),
    onFilesSelected: () => {},
    multiple: true,
    maxFiles: 5,
    acceptedFileTypes: ["application/pdf"],
  },
};
