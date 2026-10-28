/**
 * CloudFilePicker component
 *
 * Main modal/dialog container for cloud file selection
 * Integrates all sub-components and manages state
 */

import { t } from "@lingui/core/macro";
import { memo, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useDebounce } from "use-debounce";

import { useCloudData } from "@/hooks/cloud/useCloudData";
import { useCloudNavigation } from "@/hooks/cloud/useCloudNavigation";
import { useCloudSearch } from "@/hooks/cloud/useCloudSearch";
import { useCloudSelection } from "@/hooks/cloud/useCloudSelection";
import { cloudFileKey } from "@/lib/api/cloudProviders/types";
import { useCloudProvidersFeature } from "@/providers/FeatureConfigProvider";
import { DEFAULT_MAX_FILES_PER_MESSAGE } from "@/utils/fileUploadLimits";

import { CloudDriveList } from "./CloudDriveList";
import { CloudItemBrowser } from "./CloudItemBrowser";
import { CloudNavigationBreadcrumb } from "./CloudNavigationBreadcrumb";
import { CloudSearchResults } from "./CloudSearchResults";
import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";
import { Input } from "../Input/Input";
import { ArrowLeftIcon, CloseIcon } from "../icons";

import type {
  CloudProvider,
  SelectedCloudFile,
} from "@/lib/api/cloudProviders/types";
import type { ChangeEvent } from "react";

export interface CloudFilePickerProps {
  /** Provider type (currently only "sharepoint" supported) */
  provider: CloudProvider;
  /** Whether the picker is open */
  isOpen: boolean;
  /** Callback when picker is closed/cancelled */
  onClose: () => void;
  /** Callback when files are selected */
  onFilesSelected: (files: SelectedCloudFile[]) => void;
  /** Allow multiple file selection */
  multiple?: boolean;
  /** Maximum number of files to select */
  maxFiles?: number;
  /** Accepted file types (extensions or mime types) */
  acceptedFileTypes?: string[];
  /** Optional chat ID to associate files with */
  chatId?: string;
}

export const CloudFilePicker = memo<CloudFilePickerProps>(
  ({
    provider,
    isOpen,
    onClose,
    onFilesSelected,
    multiple = false,
    maxFiles = DEFAULT_MAX_FILES_PER_MESSAGE,
    acceptedFileTypes = [],
  }) => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [driveSearchQuery, setDriveSearchQuery] = useState("");
    const [debouncedDriveSearchQuery] = useDebounce(driveSearchQuery, 200);
    const { sharepointShowDisclaimer } = useCloudProvidersFeature();

    // Navigation state
    const {
      driveId,
      itemId,
      breadcrumbs,
      goToDrive,
      navigateToFolder,
      navigateToBreadcrumb,
      goBack,
      reset,
      canGoBack,
    } = useCloudNavigation();

    // Selection state
    const {
      selectedFiles,
      toggleFile,
      isSelected,
      removeFile,
      canSelect,
      getDisabledReason,
      clearSelection,
      isMaxReached,
    } = useCloudSelection({ multiple, maxFiles, acceptedFileTypes });

    // Data fetching using generated hooks
    const searching = driveId === null && driveSearchQuery.trim().length > 0;
    const search = useCloudSearch({
      provider,
      query: debouncedDriveSearchQuery,
      enabled: isOpen && searching,
    });
    const waitingForDebounce =
      driveSearchQuery.trim() !== debouncedDriveSearchQuery.trim();
    const {
      drives,
      items,
      isLoading,
      error: browseError,
      refetchDrives,
      refetchItems,
    } = useCloudData({
      provider,
      driveId,
      itemId,
      enabled: isOpen && !searching,
    });

    // Handle drive selection
    const handleSelectDrive = useCallback(
      (drive: { id: string; name: string }) => {
        setDriveSearchQuery("");
        goToDrive(drive.id, drive.name);
      },
      [goToDrive],
    );

    // Handle folder navigation
    const handleOpenFolder = useCallback(
      (item: { id: string; name: string; is_folder: boolean }) => {
        if (item.is_folder) {
          navigateToFolder(item.id, item.name);
        }
      },
      [navigateToFolder],
    );

    // Handle back button
    const handleGoBack = useCallback(() => {
      goBack();
    }, [goBack]);

    // Handle cancel
    const handleCancel = useCallback(() => {
      reset();
      clearSelection();
      setError(null);
      setDriveSearchQuery("");
      onClose();
    }, [reset, clearSelection, onClose]);

    const handleDriveSearchChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        setDriveSearchQuery(event.target.value);
      },
      [],
    );

    // Handle confirm
    const handleConfirm = useCallback(async () => {
      if (selectedFiles.length === 0) {
        return;
      }

      try {
        setIsSubmitting(true);
        setError(null);

        // Call the onFilesSelected callback
        onFilesSelected(selectedFiles);

        // Reset and close
        reset();
        clearSelection();
        setDriveSearchQuery("");
        onClose();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t({
                id: "cloudFilePicker.error.selectFiles",
                message: "Failed to select files. Please try again.",
              }),
        );
      } finally {
        setIsSubmitting(false);
      }
    }, [selectedFiles, onFilesSelected, reset, clearSelection, onClose]);

    // Handle keyboard shortcuts
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        // Escape key to close
        if (e.key === "Escape") {
          handleCancel();
        }
        // Backspace/Back to go back one level
        if (
          e.key === "Backspace" &&
          canGoBack &&
          e.target === e.currentTarget
        ) {
          e.preventDefault();
          handleGoBack();
        }
      },
      [handleCancel, handleGoBack, canGoBack],
    );

    if (!isOpen) {
      return null;
    }

    const showDriveList = driveId === null;
    const showItemBrowser = driveId !== null;

    return createPortal(
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-picker-title"
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <div className="theme-transition flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg bg-theme-bg-primary shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus focus-visible:ring-offset-2 sm:max-h-[80vh]">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-theme-border px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
              {canGoBack && (
                <button
                  type="button"
                  onClick={handleGoBack}
                  className="theme-transition shrink-0 rounded p-1 hover:bg-theme-bg-hover"
                  aria-label={t({
                    id: "cloudFilePicker.navigation.goBack",
                    message: "Go back",
                  })}
                >
                  <ArrowLeftIcon className="size-5" />
                </button>
              )}
              <h2
                id="cloud-picker-title"
                className="truncate text-base font-semibold text-theme-fg-primary sm:text-lg"
              >
                {t({
                  id: "cloudFilePicker.title",
                  message: "Select files from cloud storage",
                })}
              </h2>
            </div>
            <button
              type="button"
              onClick={handleCancel}
              className="theme-transition shrink-0 rounded p-1 hover:bg-theme-bg-hover"
              aria-label={t({
                id: "cloudFilePicker.close",
                message: "Close",
              })}
            >
              <CloseIcon className="size-5" />
            </button>
          </div>

          {/* Breadcrumb */}
          {showItemBrowser && (
            <div className="overflow-x-auto border-b border-theme-border px-4 py-2 sm:px-6 sm:py-3">
              <CloudNavigationBreadcrumb
                breadcrumbs={breadcrumbs}
                onNavigate={navigateToBreadcrumb}
              />
            </div>
          )}

          {/* Content */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
            {error && (
              <div className="mb-4 rounded border border-theme-error-border bg-theme-error-bg p-3 text-sm text-theme-error-fg">
                {error}
              </div>
            )}

            {showDriveList && (
              <>
                {provider === "sharepoint" && sharepointShowDisclaimer && (
                  <Alert type="info" className="mb-3">
                    {t({
                      id: "cloudFilePicker.sharepoint.disclaimer",
                      message:
                        "You may see SharePoint or OneDrive directories you do not expect to access. This can happen, for example, when a SharePoint site has been shared with the whole organization by its owner.",
                    })}
                  </Alert>
                )}
                <div className="mb-3">
                  <Input
                    type="search"
                    maxLength={200}
                    aria-label={t({
                      id: "cloudFilePicker.search",
                      message: "Search drives and files…",
                    })}
                    value={driveSearchQuery}
                    onChange={handleDriveSearchChange}
                    placeholder={t({
                      id: "cloudFilePicker.search",
                      message: "Search drives and files…",
                    })}
                  />
                </div>
                {searching ? (
                  <CloudSearchResults
                    drives={search.drives}
                    files={search.files}
                    isLoading={waitingForDebounce || search.isLoading}
                    error={!waitingForDebounce && !!search.error}
                    truncated={search.truncated}
                    onRetry={search.refetch}
                    onSelectDrive={handleSelectDrive}
                    onToggleFile={toggleFile}
                    isSelected={isSelected}
                    getDisabledReason={getDisabledReason}
                    multiple={multiple}
                  />
                ) : (
                  !browseError && (
                    <CloudDriveList
                      drives={drives}
                      onSelectDrive={handleSelectDrive}
                      isLoading={isLoading}
                    />
                  )
                )}
              </>
            )}

            {!searching && browseError && (
              <Alert type="error">
                {t({
                  id: "cloudFilePicker.loadError",
                  message: "Could not load files. Please try again.",
                })}
                <Button
                  variant="secondary"
                  onClick={driveId ? refetchItems : refetchDrives}
                >
                  {t({ id: "cloudFilePicker.retry", message: "Retry" })}
                </Button>
              </Alert>
            )}
            {showItemBrowser && !browseError && (
              <CloudItemBrowser
                items={items}
                selectedIds={selectedFiles
                  .filter(
                    (f) => f.provider === provider && f.drive_id === driveId,
                  )
                  .map((f) => f.item_id)}
                onToggleItem={(item) =>
                  toggleFile({
                    ...item,
                    location: breadcrumbs
                      .map((segment) => segment.name)
                      .join(" / "),
                  })
                }
                onOpenFolder={handleOpenFolder}
                canSelect={canSelect}
                getDisabledReason={getDisabledReason}
                isLoading={isLoading}
                multiple={multiple}
              />
            )}
          </div>

          {selectedFiles.length > 0 && (
            <ul
              className="max-h-28 shrink-0 overflow-y-auto border-t border-theme-border px-4 py-2"
              aria-label={t({
                id: "cloudFilePicker.selectedFiles",
                message: "Selected files",
              })}
            >
              {selectedFiles.map((file) => {
                const fileName = file.name;
                return (
                  <li
                    key={cloudFileKey(file)}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span
                      className="min-w-0 truncate"
                      title={[file.location, file.name]
                        .filter(Boolean)
                        .join(" / ")}
                    >
                      {file.name}
                      {file.location && (
                        <span className="ml-2 text-xs text-theme-fg-muted">
                          {file.location}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 p-1 text-theme-fg-muted hover:text-theme-fg-primary"
                      onClick={() => removeFile(file)}
                      aria-label={t({
                        id: "cloudFilePicker.removeFile",
                        message: `Remove ${fileName}`,
                      })}
                    >
                      <CloseIcon className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {/* Footer */}
          <div className="flex flex-col items-stretch justify-between gap-3 border-t border-theme-border px-4 py-3 sm:flex-row sm:items-center sm:px-6 sm:py-4">
            <div className="text-center text-xs text-theme-fg-muted sm:text-left sm:text-sm">
              {selectedFiles.length > 0 ? (
                multiple ? (
                  <>
                    {selectedFiles.length}{" "}
                    {t({ id: "cloudFilePicker.selection.of", message: "of" })}{" "}
                    {maxFiles}{" "}
                    {t({
                      id: "cloudFilePicker.selection.filesSelected",
                      message: "files selected",
                    })}
                  </>
                ) : (
                  t({
                    id: "cloudFilePicker.selection.oneFile",
                    message: "1 file selected",
                  })
                )
              ) : (
                t({
                  id: "cloudFilePicker.selection.none",
                  message: "No files selected",
                })
              )}
              {isMaxReached && (
                <span className="ml-2 text-theme-warning-fg">
                  {t({
                    id: "cloudFilePicker.selection.maxReached",
                    message: "(Maximum reached)",
                  })}
                </span>
              )}
            </div>
            <div className="flex justify-center gap-2 sm:justify-end">
              <Button
                variant="secondary"
                onClick={handleCancel}
                disabled={isSubmitting}
              >
                {t({ id: "cloudFilePicker.actions.cancel", message: "Cancel" })}
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleConfirm()}
                disabled={selectedFiles.length === 0 || isSubmitting}
              >
                {isSubmitting
                  ? t({
                      id: "cloudFilePicker.actions.selecting",
                      message: "Selecting...",
                    })
                  : selectedFiles.length > 0
                    ? `${t({ id: "cloudFilePicker.actions.select", message: "Select" })} (${selectedFiles.length})`
                    : t({
                        id: "cloudFilePicker.actions.select",
                        message: "Select",
                      })}
              </Button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
CloudFilePicker.displayName = "CloudFilePicker";
