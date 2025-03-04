import React, { useRef, ReactNode } from "react";
import { FileType, FileTypeUtil } from "@/utils/fileTypes";

interface FileInputProps {
  /** Callback when files are selected */
  onFilesSelected: (files: File[]) => void;
  /** Array of accepted file types, or empty for all enabled types */
  acceptedFileTypes?: FileType[];
  /** Allow multiple file selection */
  multiple?: boolean;
  /** The children that will trigger the file selection when clicked */
  children: ReactNode;
  /** ID for the input element */
  id?: string;
  /** Additional class name */
  className?: string;
  /** Input disabled state */
  disabled?: boolean;
}

/**
 * A component that wraps a hidden file input and provides a way to trigger it
 */
export const FileInput: React.FC<FileInputProps> = ({
  onFilesSelected,
  acceptedFileTypes = [],
  multiple = true,
  children,
  id,
  className,
  disabled = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle click on the children to trigger file input
  const handleClick = () => {
    if (disabled) return;
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Handle file selection
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    onFilesSelected(fileArray);

    // Reset the input so the same file can be selected again
    e.target.value = "";
  };

  // Get accept attribute string based on file types
  const acceptAttribute = FileTypeUtil.getAcceptString(acceptedFileTypes);

  return (
    <>
      <div
        onClick={handleClick}
        className={className}
        style={{ cursor: disabled ? "not-allowed" : "pointer" }}
      >
        {children}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        id={id}
        accept={acceptAttribute}
        multiple={multiple}
        onChange={handleChange}
        style={{ display: "none" }}
        disabled={disabled}
        aria-hidden="true"
      />
    </>
  );
};
