import {
  PlusIcon,
  ArrowUpIcon,
  ArrowPathIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import React, { useState, useRef, useEffect } from "react";

import { FileTypeUtil } from "@/utils/fileTypes";

import { Alert } from "./Alert";
import { Button } from "./Button";
import { FileInput } from "./FileInput";
import { FilePreview } from "./FilePreview";
import { Tooltip } from "./Tooltip";

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
    <form className={clsx("w-2/3 mx-auto mb-4")} onSubmit={handleSubmit}>
      {/* File previews */}
      {selectedFiles.length > 0 && (
        <div className="mb-3">
          <div className="flex justify-between items-center mb-2">
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
                  icon={<XMarkIcon className="h-3 w-3 mr-1" />}
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
          "p-3",
          "shadow-[0_0_15px_rgba(0,0,0,0.1)]",
          "border border-theme-border",
          "focus-within:border-theme-border-focus theme-transition",
          "flex flex-col gap-3",
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
            "px-3 py-2",
            "bg-transparent",
            "text-theme-fg-primary placeholder:text-theme-fg-muted",
            "focus:outline-none",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "min-h-[24px] max-h-[200px]",
          )}
        />

        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
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
                      icon={<PlusIcon />}
                      aria-label="Add File"
                      disabled={selectedFiles.length >= maxFiles}
                    />
                  </Tooltip>
                </FileInput>
                <Tooltip content="Regenerate response">
                  <Button
                    onClick={onRegenerate}
                    variant="icon-only"
                    icon={<ArrowPathIcon />}
                    size="sm"
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
            icon={<ArrowUpIcon />}
            size="sm"
            aria-label="Send message"
          />
        </div>
      </div>
    </form>
  );
};
