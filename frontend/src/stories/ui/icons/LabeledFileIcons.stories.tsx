import { FileIcon, PackageIcon } from "@/components/ui/icons";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Icons/LabeledFileIcons",
  component: FileIcon,
  args: {
    label: ".exe",
    width: 38,
    height: 38,
    strokeWidth: 1.5,
  },
} satisfies Meta<typeof FileIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const File: Story = {};

export const Package: Story = {
  args: { label: ".msi" },
  render: (args) => <PackageIcon {...args} />,
};

export const DistributionArtifacts: Story = {
  render: () => (
    <div className="flex gap-4 text-theme-fg-primary">
      {[
        <FileIcon key="exe" label=".exe" width={38} height={38} />,
        <PackageIcon key="msi" label=".msi" width={38} height={38} />,
        <PackageIcon key="app" label=".app" width={38} height={38} />,
        <PackageIcon key="dmg" label=".dmg" width={38} height={38} />,
        <PackageIcon key="pkg" label=".pkg" width={38} height={38} />,
        <FileIcon key="binary" width={38} height={38} />,
        <PackageIcon key="archive" label=".tar.gz" width={38} height={38} />,
      ].map((icon) => (
        <div key={icon.key} className="rounded-xl bg-theme-bg-accent p-0.5">
          {icon}
        </div>
      ))}
    </div>
  ),
};
