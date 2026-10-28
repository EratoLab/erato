import { t } from "@lingui/core/macro";

import { cloudFileKey } from "@/lib/api/cloudProviders/types";
import { formatFileSize } from "@/stories/ui/cloud/mockCloudData";

import { CloudDriveList } from "./CloudDriveList";
import { CloudFileTypeIcon } from "./CloudFileTypeIcon";
import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";

import type { CloudDrive, CloudItem } from "@/lib/api/cloudProviders/types";
import type { SearchFileHit } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

type SearchFile = SearchFileHit & CloudItem;

export interface CloudSearchResultsProps {
  drives: CloudDrive[];
  files: SearchFile[];
  isLoading: boolean;
  error: boolean;
  truncated: boolean;
  onRetry: () => void;
  onSelectDrive: (drive: CloudDrive) => void;
  onToggleFile: (file: CloudItem) => void;
  isSelected: (file: CloudItem) => boolean;
  getDisabledReason: (file: CloudItem) => string | null;
  multiple: boolean;
}

export function CloudSearchResults({
  drives,
  files,
  isLoading,
  error,
  truncated,
  onRetry,
  onSelectDrive,
  onToggleFile,
  isSelected,
  getDisabledReason,
  multiple,
}: CloudSearchResultsProps) {
  if (isLoading)
    return (
      <p role="status" className="py-6 text-theme-fg-muted">
        {t({
          id: "cloudFilePicker.searching",
          message: "Searching drives and files…",
        })}
      </p>
    );
  if (error)
    return (
      <Alert type="error">
        {t({
          id: "cloudFilePicker.searchError",
          message: "Search failed. Please try again.",
        })}
        <Button variant="secondary" onClick={onRetry}>
          {t({ id: "cloudFilePicker.retry", message: "Retry" })}
        </Button>
      </Alert>
    );

  return (
    <div className="space-y-4">
      {truncated && (
        <Alert type="info">
          {t({
            id: "cloudFilePicker.searchTruncated",
            message:
              "Search limits reached. Refine your search to find more files.",
          })}
        </Alert>
      )}
      {drives.length === 0 && files.length === 0 && (
        <p role="status" className="py-6 text-theme-fg-muted">
          {t({
            id: "cloudFilePicker.noResults",
            message: "No matching drives or files found.",
          })}
        </p>
      )}
      {drives.length > 0 && (
        <CloudDriveList drives={drives} onSelectDrive={onSelectDrive} />
      )}
      <ul className="divide-y divide-theme-border">
        {files.map((file) => {
          const disabledReason = getDisabledReason(file);
          const location = [
            file.site_name,
            file.drive_name,
            file.parent_path?.replace(/^\/+/, ""),
          ]
            .filter(Boolean)
            .join(" / ");
          return (
            <li key={cloudFileKey(file)}>
              <label
                className={`flex cursor-pointer items-start gap-3 py-3 ${disabledReason ? "opacity-50" : "hover:bg-theme-bg-hover"}`}
              >
                <input
                  type={multiple ? "checkbox" : "radio"}
                  name="cloud-search-file"
                  checked={isSelected(file)}
                  disabled={!!disabledReason}
                  onChange={() => onToggleFile(file)}
                  aria-label={file.name}
                  className="mt-1 size-4 shrink-0 accent-[var(--theme-fg-accent)]"
                />
                <CloudFileTypeIcon
                  isFolder={false}
                  mimeType={file.mime_type}
                  fileName={file.name}
                  className="mt-1 size-5 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate font-medium text-theme-fg-primary"
                    title={file.name}
                  >
                    {file.name}
                  </span>
                  <span
                    className="block break-words text-sm text-theme-fg-muted"
                    title={location}
                  >
                    {location}
                  </span>
                  <span className="block text-xs text-theme-fg-muted">
                    {[
                      formatFileSize(file.size),
                      file.last_modified
                        ? new Date(file.last_modified).toLocaleDateString()
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {disabledReason && (
                    <span className="block text-xs text-theme-fg-muted">
                      {disabledReason}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
