import { PlusIcon } from "@heroicons/react/24/outline";
import React, { useRef, useState, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { useFileUpload } from "../../../hooks/useFileUpload";
import { FileTypeUtil } from "../../../utils/fileTypes";

import type { FileUploadItem } from "../../../lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "../../../utils/fileTypes";

interface FileUploadButtonProps {
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
}

// Loading state component
const FileUploadButtonLoading: React.FC = () => (
  <button
    disabled
    className="inline-flex items-center justify-center rounded-md bg-gray-100 p-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
  >
    <svg
      className="size-5 animate-spin text-gray-500"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      ></circle>
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      ></path>
    </svg>
  </button>
);

// Error state component
const FileUploadButtonError: React.FC<{ error: Error }> = ({ error }) => (
  <button
    disabled
    className="inline-flex items-center justify-center rounded-md bg-red-100 p-1.5 text-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
    title={error.message}
  >
    <svg
      className="size-5 text-red-500"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
        clipRule="evenodd"
      />
    </svg>
  </button>
);

// Inner component that can throw during loading
const FileUploadButtonInner: React.FC<FileUploadButtonProps> = ({
  onFilesUploaded,
  acceptedFileTypes = [],
  multiple = false,
  label = "Attach File",
  className = "",
  disabled = false,
  iconOnly = true,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  // Use our file upload hook
  const { uploadFiles, isUploading, error } = useFileUpload({
    onUploadSuccess: (files) => {
      onFilesUploaded?.(files);
      // Reset the file input so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
  });

  // Handle file selection
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    // Use void to explicitly ignore the promise
    void uploadFiles(files);
  };

  // Trigger file input click
  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  // Generate accept string from accepted file types
  const acceptString = FileTypeUtil.getAcceptString(acceptedFileTypes);

  // Show loading state if uploading
  if (isUploading) {
    return <FileUploadButtonLoading />;
  }

  // Show error state if there was an error
  if (error) {
    return <FileUploadButtonError error={error} />;
  }

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept={acceptString}
        multiple={multiple}
        onChange={handleFileSelect}
        disabled={disabled || isUploading}
      />
      <button
        type="button"
        className={`inline-flex items-center ${iconOnly ? "justify-center p-1.5" : "gap-2 px-4 py-2"} rounded-md text-sm font-medium ${
          isHovered
            ? "bg-blue-100 text-blue-700"
            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
        } focus:outline-none focus:ring-2 focus:ring-blue-500 ${className}`}
        onClick={handleButtonClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        disabled={disabled || isUploading}
      >
        <PlusIcon
          className={`size-5 ${isHovered ? "text-blue-500" : "text-gray-500"}`}
        />
        {!iconOnly && label}
      </button>
    </>
  );
};

/**
 * Button component for file uploads with Suspense support
 */
export const FileUploadButton: React.FC<FileUploadButtonProps> = (props) => {
  return (
    <ErrorBoundary
      FallbackComponent={({ error }) => <FileUploadButtonError error={error} />}
      onReset={() => {
        // Reset the error state when the error boundary is reset
        // This is triggered when the user clicks a "try again" button in the fallback
      }}
    >
      <Suspense fallback={<FileUploadButtonLoading />}>
        <FileUploadButtonInner {...props} />
      </Suspense>
    </ErrorBoundary>
  );
};
