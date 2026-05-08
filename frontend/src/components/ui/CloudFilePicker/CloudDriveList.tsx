/**
 * CloudDriveList component
 *
 * Displays all accessible drives in a grid or list layout
 */

import { t } from "@lingui/core/macro";
import { memo } from "react";

import { FolderIcon, OpenNewWindowIcon } from "../icons";

import type { CloudDrive } from "@/lib/api/cloudProviders/types";

interface CloudDriveListProps {
  drives: CloudDrive[];
  onSelectDrive: (drive: CloudDrive) => void;
  isLoading?: boolean;
  className?: string;
}

function getDriveBadgeColor(kind: string): string {
  switch (kind) {
    case "personal_onedrive":
      return "bg-theme-bg-accent text-theme-fg-primary";
    case "teams_group_library":
      return "bg-theme-bg-accent text-theme-fg-primary";
    case "microsoft_365_group_library":
      return "bg-theme-bg-accent text-theme-fg-primary";
    case "sharepoint_site_library":
      return "bg-theme-bg-accent text-theme-fg-primary";
    case "sharepoint_list":
      return "bg-theme-bg-accent text-theme-fg-primary";
    default:
      return "bg-theme-bg-accent text-theme-fg-primary";
  }
}

function getDriveKindLabel(kind: string): string {
  switch (kind) {
    case "personal_onedrive":
      return t({
        id: "cloudDriveList.driveKind.personalOneDrive",
        message: "Personal OneDrive",
      });
    case "teams_group_library":
      return t({
        id: "cloudDriveList.driveKind.teamsGroupLibrary",
        message: "Teams library",
      });
    case "microsoft_365_group_library":
      return t({
        id: "cloudDriveList.driveKind.microsoft365GroupLibrary",
        message: "Group library",
      });
    case "sharepoint_site_library":
      return t({
        id: "cloudDriveList.driveKind.sharepointSiteLibrary",
        message: "SharePoint site",
      });
    case "sharepoint_list":
      return t({
        id: "cloudDriveList.driveKind.sharepointList",
        message: "SharePoint list",
      });
    case "business_library":
      return t({
        id: "cloudDriveList.driveKind.businessLibrary",
        message: "Business library",
      });
    case "other":
      return t({
        id: "cloudDriveList.driveKind.other",
        message: "Other",
      });
    default:
      return kind;
  }
}

function getDriveVisibilityLabel(visibility: string): string {
  switch (visibility) {
    case "Public":
      return t({
        id: "cloudDriveList.visibility.public",
        message: "Public",
      });
    case "Private":
      return t({
        id: "cloudDriveList.visibility.private",
        message: "Private",
      });
    case "HiddenMembership":
      return t({
        id: "cloudDriveList.visibility.hiddenMembership",
        message: "Hidden membership",
      });
    default:
      return visibility;
  }
}

function getDriveDetailLines(drive: CloudDrive): string[] {
  const lines: string[] = [];
  const siteLabel = t({ id: "cloudDriveList.siteLabel", message: "Site" });
  const ownerLabel = t({ id: "cloudDriveList.ownerLabel", message: "Owner" });
  const visibilityLabel = t({
    id: "cloudDriveList.visibilityLabel",
    message: "Visibility",
  });

  if (drive.site_name) {
    lines.push(`${siteLabel}: ${drive.site_name}`);
  }

  if (drive.owner_name) {
    lines.push(`${ownerLabel}: ${drive.owner_name}`);
  }

  if (drive.group_visibility) {
    lines.push(
      `${visibilityLabel}: ${getDriveVisibilityLabel(drive.group_visibility)}`,
    );
  }

  return lines;
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
            {t({
              id: "cloudDriveList.empty.noDrives",
              message: "No drives available",
            })}
          </p>
        </div>
      );
    }

    return (
      <div className={`grid gap-3 ${className}`}>
        {drives.map((drive) => (
          <div
            key={drive.id}
            className="rounded-lg border border-theme-border bg-theme-bg-primary"
          >
            <button
              type="button"
              onClick={() => onSelectDrive(drive)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectDrive(drive);
                }
              }}
              className="theme-transition focus-ring w-full rounded-lg p-4 text-left hover:bg-theme-bg-hover"
              aria-label={t({
                id: "cloudDriveList.openDrive",
                message: "Open drive",
              })}
            >
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded bg-theme-bg-secondary">
                  <FolderIcon className="size-6 text-theme-fg-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="min-w-0 flex-1 truncate font-medium text-theme-fg-primary">
                      {drive.name}
                    </h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${getDriveBadgeColor(drive.kind)}`}
                    >
                      {getDriveKindLabel(drive.kind)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {getDriveDetailLines(drive).map((line) => (
                      <p
                        key={line}
                        className="truncate text-sm text-theme-fg-muted"
                      >
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </button>
            {drive.web_url && (
              <div className="flex justify-end border-t border-theme-border px-4 py-2">
                <a
                  href={drive.web_url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  className="theme-transition inline-flex items-center gap-1.5 rounded text-sm text-theme-fg-secondary hover:text-theme-fg-primary"
                >
                  <span>
                    {t({
                      id: "cloudDriveList.viewInSharepoint",
                      message: "View in Sharepoint",
                    })}
                  </span>
                  <OpenNewWindowIcon className="size-4" />
                </a>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
CloudDriveList.displayName = "CloudDriveList";
