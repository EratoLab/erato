import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useOffice } from "../providers/OfficeProvider";
import { useOutlookMailItem } from "../providers/OutlookMailItemProvider";
import { emailToHtmlFile } from "../utils/emailToFile";

type CloudProvider = "sharepoint" | "googledrive";

interface AddinFileSourceSelectorProps {
  availableProviders: CloudProvider[];
  onSelectDisk: () => void;
  onSelectCloud: (provider: CloudProvider) => void;
  onSelectFiles?: (files: File[]) => Promise<void>;
  disabled?: boolean;
  isProcessing?: boolean;
  className?: string;
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function AddinFileSourceSelector({
  availableProviders,
  onSelectDisk,
  onSelectCloud,
  onSelectFiles,
  disabled = false,
  isProcessing = false,
  className = "",
}: AddinFileSourceSelectorProps) {
  const { host } = useOffice();
  const { mailItem, attachments, isLoadingAttachments, getAttachmentFile } =
    useOutlookMailItem();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEmailContentOpen, setIsEmailContentOpen] = useState(false);
  const [isUploadingEmailContent, setIsUploadingEmailContent] = useState(false);

  const isBusy = disabled || isProcessing || isUploadingEmailContent;
  const canShowEmailContent = host === "Outlook";
  const emailBodyFile = useMemo(() => {
    if (!mailItem || mailItem.isLoadingBody) {
      return null;
    }

    return emailToHtmlFile(mailItem);
  }, [mailItem]);
  const selectableAttachments = useMemo(
    () => attachments.filter((attachment) => !attachment.isInline),
    [attachments],
  );

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsMenuOpen(false);
        setIsEmailContentOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
        setIsEmailContentOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isMenuOpen]);

  const closeMenus = useCallback(() => {
    setIsMenuOpen(false);
    setIsEmailContentOpen(false);
  }, []);

  const handleUploadResolvedFiles = useCallback(
    async (files: File[]) => {
      if (!onSelectFiles || files.length === 0) {
        return;
      }

      setIsUploadingEmailContent(true);
      try {
        await onSelectFiles(files);
        closeMenus();
      } catch (error) {
        console.warn("Failed to upload Outlook email content:", error);
      } finally {
        setIsUploadingEmailContent(false);
      }
    },
    [closeMenus, onSelectFiles],
  );

  const handleSelectDisk = useCallback(() => {
    closeMenus();
    onSelectDisk();
  }, [closeMenus, onSelectDisk]);

  const handleSelectCloudProvider = useCallback(
    (provider: CloudProvider) => {
      closeMenus();
      onSelectCloud(provider);
    },
    [closeMenus, onSelectCloud],
  );

  const handleSelectEmailBody = useCallback(() => {
    if (!emailBodyFile) {
      return;
    }

    void handleUploadResolvedFiles([emailBodyFile]);
  }, [emailBodyFile, handleUploadResolvedFiles]);

  const handleSelectAttachment = useCallback(
    (attachmentId: string) => {
      void (async () => {
        try {
          const file = await getAttachmentFile(attachmentId);
          await handleUploadResolvedFiles([file]);
        } catch (error) {
          console.warn(
            "Failed to resolve Outlook attachment for upload:",
            error,
          );
        }
      })();
    },
    [getAttachmentFile, handleUploadResolvedFiles],
  );

  const hasAnyEmailContent =
    !!emailBodyFile || selectableAttachments.length > 0 || isLoadingAttachments;
  const canUploadEmailContent = !!onSelectFiles;

  const triggerLabel = isBusy ? "..." : "+";
  const triggerButtonClassName = [
    "inline-flex size-8 items-center justify-center rounded-md text-lg font-medium text-theme-fg-secondary transition-colors hover:bg-theme-bg-hover disabled:cursor-not-allowed disabled:opacity-50",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsMenuOpen((previous) => !previous)}
        disabled={isBusy}
        aria-label="Add files"
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
        className={triggerButtonClassName}
      >
        {triggerLabel}
      </button>

      {isMenuOpen && (
        <div className="absolute left-0 top-full z-50 mt-2 w-80 rounded-xl border border-theme-border bg-theme-bg-primary p-2 shadow-lg">
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={handleSelectDisk}
              disabled={isBusy}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-theme-fg-primary transition-colors hover:bg-theme-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>Upload from Computer</span>
            </button>

            {availableProviders.includes("sharepoint") && (
              <button
                type="button"
                onClick={() => handleSelectCloudProvider("sharepoint")}
                disabled={isBusy}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-theme-fg-primary transition-colors hover:bg-theme-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span>Upload from OneDrive</span>
              </button>
            )}

            {canShowEmailContent && (
              <>
                <button
                  type="button"
                  onClick={() => setIsEmailContentOpen((previous) => !previous)}
                  disabled={
                    isBusy || !canUploadEmailContent || !hasAnyEmailContent
                  }
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-theme-fg-primary transition-colors hover:bg-theme-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>Email content</span>
                  <span className="text-xs text-theme-fg-muted">
                    {isEmailContentOpen ? "Hide" : "Show"}
                  </span>
                </button>

                {isEmailContentOpen && (
                  <div className="max-h-72 overflow-y-auto rounded-lg border border-theme-border bg-theme-bg-secondary p-1">
                    {mailItem?.isLoadingBody && (
                      <div className="px-3 py-2 text-xs text-theme-fg-muted">
                        Loading email thread...
                      </div>
                    )}

                    {emailBodyFile && (
                      <button
                        type="button"
                        onClick={handleSelectEmailBody}
                        disabled={isBusy}
                        title={emailBodyFile.name}
                        className="flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-theme-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-theme-fg-primary">
                            Email thread
                          </div>
                          <div className="truncate text-xs text-theme-fg-muted">
                            {emailBodyFile.name}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs text-theme-fg-muted">
                          {formatFileSize(emailBodyFile.size)}
                        </span>
                      </button>
                    )}

                    {isLoadingAttachments && (
                      <div className="px-3 py-2 text-xs text-theme-fg-muted">
                        Loading attachments...
                      </div>
                    )}

                    {selectableAttachments.map((attachment) => {
                      const isCloudAttachment =
                        String(attachment.attachmentType).toLowerCase() ===
                        "cloud";

                      return (
                        <button
                          key={attachment.id}
                          type="button"
                          onClick={() => handleSelectAttachment(attachment.id)}
                          disabled={isBusy || isCloudAttachment}
                          title={attachment.name}
                          className="flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-theme-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-theme-fg-primary">
                              {attachment.name}
                            </div>
                            <div className="truncate text-xs text-theme-fg-muted">
                              {isCloudAttachment
                                ? "Cloud attachment cannot be uploaded from Outlook"
                                : attachment.contentType || "Attachment"}
                            </div>
                          </div>
                          <span className="shrink-0 text-xs text-theme-fg-muted">
                            {formatFileSize(attachment.size)}
                          </span>
                        </button>
                      );
                    })}

                    {!mailItem?.isLoadingBody &&
                      !isLoadingAttachments &&
                      !emailBodyFile &&
                      selectableAttachments.length === 0 && (
                        <div className="px-3 py-2 text-xs text-theme-fg-muted">
                          No email content is available for this item.
                        </div>
                      )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
