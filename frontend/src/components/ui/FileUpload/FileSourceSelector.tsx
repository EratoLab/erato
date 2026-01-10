import { t } from "@lingui/core/macro";
import { Cloud, Computer } from "iconoir-react";
import { memo } from "react";

import { DropdownMenu } from "../Controls/DropdownMenu";
import { PlusIcon } from "../icons";
import { FileUploadLoading } from "./FileUploadStates";

import type { DropdownMenuItem } from "../Controls/DropdownMenu";
import type { CloudProvider } from "@/providers/FeatureConfigProvider";

export interface FileSourceSelectorProps {
  /** List of available cloud providers */
  availableProviders: CloudProvider[];
  /** Callback when "Upload from Computer" is selected */
  onSelectDisk: () => void;
  /** Callback when a cloud provider is selected */
  onSelectCloud: (provider: CloudProvider) => void;
  /** Whether the selector is disabled */
  disabled?: boolean;
  /** Whether files are currently being processed (uploading or linking) */
  isProcessing?: boolean;
  /** Custom CSS class */
  className?: string;
}

/**
 * FileSourceSelector Component
 *
 * Displays a dropdown menu allowing users to choose between uploading from:
 * - Computer (local disk)
 * - OneDrive/Sharepoint (when available)
 * - Google Drive (future, when available)
 *
 * When no cloud providers are available, this component should not be used;
 * instead, use the direct FileUploadButton.
 */
export const FileSourceSelector = memo<FileSourceSelectorProps>(
  ({
    availableProviders,
    onSelectDisk,
    onSelectCloud,
    disabled = false,
    isProcessing = false,
    className = "",
  }) => {
    if (isProcessing) {
      return <FileUploadLoading className={className} />;
    }

    // Build menu items based on available providers
    const menuItems: DropdownMenuItem[] = [
      // Always show "Upload from Computer" option
      {
        label: t({
          id: "fileSourceSelector.uploadFromComputer",
          message: "Upload from Computer",
        }),
        icon: <Computer className="size-4" />,
        onClick: onSelectDisk,
        disabled,
      },
    ];

    // Add cloud provider options
    if (availableProviders.includes("sharepoint")) {
      menuItems.push({
        label: t({
          id: "fileSourceSelector.uploadFromOneDrive",
          message: "Upload from OneDrive",
        }),
        icon: <Cloud className="size-4" />,
        onClick: () => onSelectCloud("sharepoint"),
        disabled,
      });
    }

    // Future: Add Google Drive
    // if (availableProviders.includes("googledrive")) {
    //   menuItems.push({
    //     label: t({
    //       id: "fileSourceSelector.uploadFromGoogleDrive",
    //       message: "Upload from Google Drive",
    //     }),
    //     icon: <Cloud className="size-4" />,
    //     onClick: () => onSelectCloud("googledrive"),
    //     disabled,
    //   });
    // }

    return (
      <DropdownMenu
        items={menuItems}
        className={className}
        align="left"
        triggerIcon={<PlusIcon className="size-5" />}
        preferredOrientation={{
          vertical: "top",
          horizontal: "left",
        }}
      />
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
FileSourceSelector.displayName = "FileSourceSelector";
