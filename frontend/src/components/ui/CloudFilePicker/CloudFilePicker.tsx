/**
 * CloudFilePicker component
 *
 * Main modal/dialog container for cloud file selection
 * Integrates all sub-components and manages state
 */

import { t } from "@lingui/core/macro";
import { memo, useCallback, useState } from "react";

import { useCloudData } from "@/hooks/cloud/useCloudData";
import { useCloudNavigation } from "@/hooks/cloud/useCloudNavigation";
import { useCloudSelection } from "@/hooks/cloud/useCloudSelection";

import { CloudDriveList } from "./CloudDriveList";
import { CloudItemBrowser } from "./CloudItemBrowser";
import { CloudNavigationBreadcrumb } from "./CloudNavigationBreadcrumb";
import { Button } from "../Controls/Button";
import { CloseIcon, ArrowLeftIcon } from "../icons";

import type {
  CloudProvider,
  SelectedCloudFile,
} from "@/lib/api/cloudProviders/types";

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
    maxFiles = 5,
    acceptedFileTypes = [],
    chatId,
  }) => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
      canSelect,
      getDisabledReason,
      clearSelection,
      isMaxReached,
    } = useCloudSelection({ multiple, maxFiles, acceptedFileTypes });

    // Data fetching using generated hooks
    const { drives, items, isLoading } = useCloudData({
      provider,
      driveId,
      itemId,
    });

    // Handle drive selection
    const handleSelectDrive = useCallback(
      (drive: { id: string; name: string }) => {
        goToDrive(drive.id, drive.name);
        clearSelection();
      },
      [goToDrive, clearSelection],
    );

    // Handle folder navigation
    const handleOpenFolder = useCallback(
      (item: { id: string; name: string; is_folder: boolean }) => {
        if (item.is_folder) {
          navigateToFolder(item.id, item.name);
          clearSelection();
        }
      },
      [navigateToFolder, clearSelection],
    );

    // Handle back button
    const handleGoBack = useCallback(() => {
      goBack();
      clearSelection();
    }, [goBack, clearSelection]);

    // Handle cancel
    const handleCancel = useCallback(() => {
      reset();
      clearSelection();
      setError(null);
      onClose();
    }, [reset, clearSelection, onClose]);

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

    return (
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-picker-title"
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <div className="theme-transition flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg bg-theme-bg-primary shadow-xl focus:outline-none focus:ring-2 focus:ring-theme-focus focus:ring-offset-2 sm:max-h-[80vh]">
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
          <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
            {error && (
              <div className="mb-4 rounded border border-theme-error-border bg-theme-error-bg p-3 text-sm text-theme-error-fg">
                {error}
              </div>
            )}

            {showDriveList && (
              <CloudDriveList
                drives={drives}
                onSelectDrive={handleSelectDrive}
                isLoading={isLoading}
              />
            )}

            {showItemBrowser && (
              <CloudItemBrowser
                items={items}
                selectedIds={selectedFiles.map((f) => f.item_id)}
                onToggleItem={toggleFile}
                onOpenFolder={handleOpenFolder}
                canSelect={canSelect}
                getDisabledReason={getDisabledReason}
                isLoading={isLoading}
                multiple={multiple}
              />
            )}
          </div>

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
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
CloudFilePicker.displayName = "CloudFilePicker";
