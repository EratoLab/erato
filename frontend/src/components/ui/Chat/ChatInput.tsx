import {
  PlusIcon,
  ArrowUpIcon,
  ArrowPathIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import React, { useState, useRef, useEffect } from "react";

import { FileTypeUtil } from "@/utils/fileTypes";

import { Button } from "../Controls/Button";
import { FileInput } from "../Controls/FileInput";
import { FilePreview } from "../Controls/FilePreview";
import { Tooltip } from "../Controls/Tooltip";
import { Alert } from "../Feedback/Alert";

import type { FileType } from "@/utils/fileTypes";

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  onAddFile?: (files: File[]) => void;
  onRegenerate?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  maxLength?: number;
  showControls?: boolean;
  /** Limit the total number of files that can be attached */
  maxFiles?: number;
  /** Array of accepted file types, or empty for all enabled types */
  acceptedFileTypes?: FileType[];
}

/**
 * ChatInput component with file attachment capabilities
 */
export const ChatInput = ({
  onSendMessage,
  onAddFile,
  onRegenerate,
  isLoading = false,
  disabled = false,
  className = "",
  placeholder = "Type a message...",
  maxLength = 2000,
  showControls = true,
  maxFiles = 5,
  acceptedFileTypes = [],
}: ChatInputProps) => {
  const [message, setMessage] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !isLoading && !disabled) {
      onSendMessage(message.trim());
      setMessage("");
      // Keep files after sending message to allow for additional messages with the same files
      // Clear files only when explicitly requested or new files are selected
    }
  };

  const handleFileInputChange = (files: File[]) => {
    setFileError(null);

    // Check if adding these files would exceed the maximum
    if (selectedFiles.length + files.length > maxFiles) {
      setFileError(`You can only attach up to ${maxFiles} files`);
      return;
    }

    // Validate and filter files
    const validFiles: File[] = [];
    const invalidFiles: { file: File; error: string }[] = [];

    for (const file of files) {
      const validation = FileTypeUtil.validateFile(file);

      if (validation.valid) {
        validFiles.push(file);
      } else {
        invalidFiles.push({ file, error: validation.error ?? "Invalid file" });
      }
    }

    // If there are invalid files, show error for the first one
    if (invalidFiles.length > 0) {
      setFileError(`${invalidFiles[0].file.name}: ${invalidFiles[0].error}`);
      // If there are multiple errors, show a more general message
      if (invalidFiles.length > 1) {
        setFileError(
          `${invalidFiles[0].file.name}: ${invalidFiles[0].error} (and ${invalidFiles.length - 1} more)`,
        );
      }
    }

    // Add valid files to selection
    if (validFiles.length > 0) {
      setSelectedFiles((prev) => [...prev, ...validFiles]);

      // Call the parent's onAddFile callback if it exists
      if (onAddFile) {
        onAddFile(validFiles);
      }
    }
  };

  const handleRemoveFile = (fileToRemove: File) => {
    setSelectedFiles((prev) => prev.filter((file) => file !== fileToRemove));
    setFileError(null);
  };

  const handleRemoveAllFiles = () => {
    setSelectedFiles([]);
    setFileError(null);
  };

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [message]);

  return (
    <form
      className={clsx("mx-auto mb-4 w-full sm:w-5/6 md:w-4/5")}
      onSubmit={handleSubmit}
    >
      {/* File previews */}
      {selectedFiles.length > 0 && (
        <div className="mb-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-theme-fg-secondary">
              Attachments ({selectedFiles.length}/{maxFiles})
            </h3>
            {selectedFiles.length > 1 && (
              <Tooltip content="Remove all files">
                <Button
                  onClick={handleRemoveAllFiles}
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  icon={<XMarkIcon className="mr-1 size-3" />}
                >
                  Remove all
                </Button>
              </Tooltip>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedFiles.map((file, index) => (
              <FilePreview
                key={`${file.name}-${index}`}
                file={file}
                onRemove={handleRemoveFile}
              />
            ))}
          </div>
        </div>
      )}

      {/* File error message */}
      {fileError && (
        <Alert
          type="error"
          dismissible
          onDismiss={() => setFileError(null)}
          className="mb-2"
        >
          {fileError}
        </Alert>
      )}

      <div
        className={clsx(
          "w-full rounded-2xl bg-theme-bg-tertiary",
          "p-2 sm:p-3",
          "shadow-[0_0_15px_rgba(0,0,0,0.1)]",
          "border border-theme-border",
          "theme-transition focus-within:border-theme-border-focus",
          "flex flex-col gap-2 sm:gap-3",
          className,
        )}
      >
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={1}
          disabled={isLoading || disabled}
          className={clsx(
            "w-full resize-none overflow-hidden",
            "p-2 sm:px-3",
            "bg-transparent",
            "text-theme-fg-primary placeholder:text-theme-fg-muted",
            "focus:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "max-h-[200px] min-h-[32px]",
            "text-base",
          )}
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 sm:gap-2">
            {showControls && (
              <>
                <FileInput
                  onFilesSelected={handleFileInputChange}
                  acceptedFileTypes={acceptedFileTypes}
                  disabled={selectedFiles.length >= maxFiles}
                >
                  <Tooltip content={`Add file${maxFiles > 1 ? "s" : ""}`}>
                    <Button
                      variant="icon-only"
                      size="sm"
                      icon={<PlusIcon className="size-5" />}
                      aria-label="Add File"
                      disabled={selectedFiles.length >= maxFiles}
                    />
                  </Tooltip>
                </FileInput>
                <Tooltip content="Regenerate response">
                  <Button
                    onClick={onRegenerate}
                    variant="icon-only"
                    size="sm"
                    icon={<ArrowPathIcon className="size-5" />}
                    aria-label="Regenerate response"
                  />
                </Tooltip>
              </>
            )}
          </div>

          <Button
            type="submit"
            variant="secondary"
            disabled={!message.trim() || isLoading || disabled}
            icon={<ArrowUpIcon className="size-5" />}
            size="sm"
            aria-label="Send message"
          />
        </div>
      </div>
    </form>
  );
};
