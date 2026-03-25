import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface ChatInputAttachmentPreviewProps {
  attachedFiles: FileUploadItem[];
  maxFiles: number;
  onRemoveFile: (fileId: string) => void;
  onRemoveAllFiles: () => void;
  onFilePreview?: (file: FileUploadItem) => void;
  disabled?: boolean;
  showFileTypes?: boolean;
}
