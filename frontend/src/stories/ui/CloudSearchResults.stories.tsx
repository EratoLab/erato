import { CloudSearchResults } from "@/components/ui/CloudFilePicker/CloudSearchResults";
import { useCloudSelection } from "@/hooks/cloud/useCloudSelection";

import type { CloudSearchResultsProps } from "@/components/ui/CloudFilePicker/CloudSearchResults";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Cloud Search Results",
  component: CloudSearchResults,
  args: {
    drives: [
      {
        id: "finance",
        name: "Finance",
        kind: "sharepoint_site_library",
        drive_type: "documentLibrary",
        provider: "sharepoint",
      },
    ],
    files: ["finance", "sales"].map((drive) => ({
      id: "same-id",
      drive_id: drive,
      drive_name: drive,
      name: "Budget 2026.pdf",
      is_folder: false,
      provider: "sharepoint" as const,
      site_name: "Public company documents",
      parent_path:
        "/Reports/Annual planning/Long folder name for planning documents",
      size: 102400,
      last_modified: "2026-10-01T12:00:00Z",
    })),
    isLoading: false,
    error: false,
    truncated: false,
    multiple: true,
    onRetry: () => {},
    onToggleFile: () => {},
    isSelected: () => false,
    getDisabledReason: () => null,
    onSelectDrive: () => {},
  },
  render: function SearchStory(args: CloudSearchResultsProps) {
    const { toggleFile, isSelected, getDisabledReason } = useCloudSelection({
      multiple: true,
      maxFiles: 1,
    });
    return (
      <CloudSearchResults
        {...args}
        onToggleFile={toggleFile}
        isSelected={isSelected}
        getDisabledReason={getDisabledReason}
      />
    );
  },
} satisfies Meta<typeof CloudSearchResults>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MixedResults: Story = {};
export const LimitedResults: Story = {
  args: { truncated: true },
};
export const Loading: Story = { args: { isLoading: true } };
export const Error: Story = { args: { error: true } };
export const Empty: Story = { args: { drives: [], files: [] } };
