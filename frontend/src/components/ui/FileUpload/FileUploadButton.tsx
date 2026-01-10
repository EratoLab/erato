import { t } from "@lingui/core/macro";
import { useState, memo, Suspense } from "react";
import { useDropzone } from "react-dropzone";
import { ErrorBoundary } from "react-error-boundary";

import { FileTypeUtil } from "@/utils/fileTypes";

import { PlusIcon } from "../icons";
import { FileUploadLoading, FileUploadError } from "./FileUploadStates";
import { BUTTON_STYLES } from "./fileUploadStyles";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";

// Re-export shared state components for backwards compatibility
export { FileUploadLoading as FileUploadButtonLoading } from "./FileUploadStates";
export { FileUploadError as FileUploadButtonError } from "./FileUploadStates";
export type { FileUploadLoadingProps as FileUploadButtonLoadingProps } from "./FileUploadStates";
export type { FileUploadErrorProps as FileUploadButtonErrorProps } from "./FileUploadStates";

/**
 * Props for the file upload button
 */
export interface FileUploadButtonProps {
  /** Callback when files are successfully uploaded */
  onFilesUploaded?: (files: FileUploadItem[]) => void;
  /** Array of accepted file types */
  acceptedFileTypes?: FileType[];
  /** Whether multiple files can be selected */
  multiple?: boolean;
  /** Custom button label */
  label?: string;
  /** Custom button className */
  className?: string;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Whether to show only the icon without text */
  iconOnly?: boolean;
  /** File upload function provided by a parent component */
  performFileUpload?: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  /** Whether a file upload is in progress */
  isUploading?: boolean;
  /** Any error that occurred during file upload */
  uploadError?: Error | null;
}

/**
 * Inner button component that handles the actual file selection
 */
const FileUploadButtonInner = memo<FileUploadButtonProps>(
  ({
    onFilesUploaded,
    acceptedFileTypes = [],
    multiple = false,
    label = t`Attach File`,
    className = "",
    disabled = false,
    iconOnly = true,
    performFileUpload,
    isUploading = false,
    uploadError = null,
  }) => {
    const [isHovered, setIsHovered] = useState(false);

    // Setup react-dropzone
    const { getRootProps, getInputProps, open } = useDropzone({
      onDrop: (acceptedFiles) => {
        if (acceptedFiles.length > 0 && performFileUpload) {
          // Call the provided upload function
          void performFileUpload(acceptedFiles).then((files) => {
            if (files) {
              onFilesUploaded?.(files);
            }
          });
        }
      },
      accept:
        acceptedFileTypes.length > 0
          ? FileTypeUtil.getAcceptObject(acceptedFileTypes)
          : undefined,
      multiple,
      disabled: disabled || isUploading,
      noClick: true, // We'll manually open the file dialog
      noKeyboard: true,
    });

    // Handle hover states
    function handleMouseEnter() {
      setIsHovered(true);
    }

    function handleMouseLeave() {
      setIsHovered(false);
    }

    // Show loading state if uploading
    if (isUploading) {
      return <FileUploadLoading className={className} />;
    }

    // Show error state if there was an error
    if (uploadError) {
      return <FileUploadError error={uploadError} className={className} />;
    }

    // Compute button styles based on props and state
    const buttonStyles = [
      BUTTON_STYLES.base,
      iconOnly ? BUTTON_STYLES.iconOnly : BUTTON_STYLES.withLabel,
      isHovered ? BUTTON_STYLES.hover : BUTTON_STYLES.default,
      className,
    ].join(" ");

    const iconStyles = `size-5 ${isHovered ? "text-blue-500" : "text-[var(--theme-fg-muted)]"}`;

    return (
      <div {...getRootProps({ className: "contents" })}>
        <input {...getInputProps()} />
        <button
          type="button"
          className={buttonStyles}
          onClick={open}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          disabled={disabled || isUploading}
          aria-label={iconOnly ? label : undefined}
        >
          <PlusIcon className={iconStyles} />
          {!iconOnly && <span>{label}</span>}
        </button>
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
FileUploadButtonInner.displayName = "FileUploadButtonInner";

/**
 * Button component for file uploads with Suspense support
 *
 * This component provides a button that triggers a file selection dialog
 * and handles the upload process, with built-in loading and error states.
 * Uses react-dropzone for optimized file selection handling.
 */
export const FileUploadButton = memo<FileUploadButtonProps>((props) => {
  return (
    <ErrorBoundary
      FallbackComponent={({ error }) => (
        <FileUploadError error={error} className={props.className} />
      )}
      onReset={() => {
        // Reset the error state when the error boundary is reset
        // This is triggered when the user clicks a "try again" button in the fallback
      }}
    >
      <Suspense fallback={<FileUploadLoading className={props.className} />}>
        <FileUploadButtonInner {...props} />
      </Suspense>
    </ErrorBoundary>
  );
});

// eslint-disable-next-line lingui/no-unlocalized-strings
FileUploadButton.displayName = "FileUploadButton";
