/**
 * CloudDriveList component
 *
 * Displays all accessible drives in a grid or list layout
 */

import { t } from "@lingui/core/macro";
import { memo } from "react";

import { FolderIcon } from "../icons";

import type { CloudDrive } from "@/lib/api/cloudProviders/types";

interface CloudDriveListProps {
  drives: CloudDrive[];
  onSelectDrive: (drive: CloudDrive) => void;
  isLoading?: boolean;
  className?: string;
}

function getDriveBadgeColor(_driveType: string): string {
  // Use theme accent color for all drive type badges
  // This ensures badges adapt to any theme without hardcoded colors
  return "bg-theme-bg-accent text-theme-fg-primary";
}

function getDriveTypeLabel(driveType: string): string {
  switch (driveType) {
    case "personal":
      return t`Personal`;
    case "documentLibrary":
      return t`Shared`;
    case "shared":
      return t`Shared`;
    default:
      return driveType;
  }
}

const DriveCardSkeleton = memo(() => (
  <div className="animate-pulse rounded-lg border border-theme-border p-4">
    <div className="flex items-start gap-3">
      <div className="size-10 rounded bg-theme-bg-accent" />
      <div className="flex-1 space-y-2">
        <div className="h-5 w-3/4 rounded bg-theme-bg-accent" />
        <div className="h-4 w-1/2 rounded bg-theme-bg-accent" />
      </div>
    </div>
  </div>
));

// eslint-disable-next-line lingui/no-unlocalized-strings
DriveCardSkeleton.displayName = "DriveCardSkeleton";

export const CloudDriveList = memo<CloudDriveListProps>(
  ({ drives, onSelectDrive, isLoading = false, className = "" }) => {
    if (isLoading) {
      return (
        <div className={`space-y-3 ${className}`}>
          <DriveCardSkeleton />
          <DriveCardSkeleton />
          <DriveCardSkeleton />
        </div>
      );
    }

    if (drives.length === 0) {
      return (
        <div
          className={`flex flex-col items-center justify-center py-12 text-center ${className}`}
        >
          <FolderIcon className="mb-3 size-12 text-theme-fg-muted" />
          <p className="text-sm text-theme-fg-muted">
            {t`No drives available`}
          </p>
        </div>
      );
    }

    return (
      <div className={`grid gap-3 ${className}`}>
        {drives.map((drive) => (
          <button
            key={drive.id}
            type="button"
            onClick={() => onSelectDrive(drive)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectDrive(drive);
              }
            }}
            className="theme-transition focus-ring rounded-lg border border-theme-border p-4 text-left hover:bg-theme-bg-hover"
            aria-label={t`Open drive`}
          >
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded bg-theme-bg-secondary">
                <FolderIcon className="size-6 text-theme-fg-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <h3 className="truncate font-medium text-theme-fg-primary">
                    {drive.name}
                  </h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${getDriveBadgeColor(drive.drive_type)}`}
                  >
                    {getDriveTypeLabel(drive.drive_type)}
                  </span>
                </div>
                {drive.owner_name && (
                  <p className="truncate text-sm text-theme-fg-muted">
                    {t`Owner:`} {drive.owner_name}
                  </p>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
CloudDriveList.displayName = "CloudDriveList";
