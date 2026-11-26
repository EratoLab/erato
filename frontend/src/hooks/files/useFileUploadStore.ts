/* eslint-disable lingui/no-unlocalized-strings */
import { create } from "zustand";
import { devtools } from "zustand/middleware";

import { registerWorkInProgress } from "@/lib/chunkLoadRecovery";
import { mergeUniqueFilesById } from "@/utils/file/mergeUniqueFilesById";

import type { UploadError } from "./errors";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Interface for file upload state
 */
interface FileUploadState {
  /**
   * Files that have been uploaded
   */
  uploadedFiles: FileUploadItem[];
  /**
   * Whether upload is in progress
   */
  isUploading: boolean;
  /**
   * Whether an upload is waiting for the server to be reachable again
   */
  isWaitingForNetwork: boolean;
  /**
   * Error message if upload failed
   */
  error: UploadError | null;
  /**
   * Stores the chat ID created silently for file uploads
   */
  silentChatId: string | null;
  /**
   * Set the uploading state
   */
  setUploading: (isUploading: boolean) => void;
  setWaitingForNetwork: (isWaitingForNetwork: boolean) => void;
  /**
   * Add successfully uploaded files to the state
   */
  addFiles: (files: FileUploadItem[]) => void;
  /**
   * Set error state
   */
  setError: (error: UploadError | null) => void;
  /**
   * Clear all uploaded files
   */
  clearFiles: () => void;
  /**
   * Reset the state
   */
  reset: () => void;
  /**
   * Set the silent chat ID
   */
  setSilentChatId: (chatId: string | null) => void;
}

/**
 * Initial state for file uploads
 */
const initialState = {
  uploadedFiles: [],
  isUploading: false,
  isWaitingForNetwork: false,
  error: null,
  silentChatId: null,
};

/**
 * Zustand store for file uploads
 */
export const useFileUploadStore = create<FileUploadState>()(
  devtools(
    (set) => ({
      ...initialState,

      setUploading: (isUploading: boolean) =>
        set({ isUploading }, false, "fileUpload/setUploading"),

      setWaitingForNetwork: (isWaitingForNetwork: boolean) =>
        set({ isWaitingForNetwork }, false, "fileUpload/setWaitingForNetwork"),

      addFiles: (files: FileUploadItem[]) =>
        set(
          (state) => ({
            uploadedFiles: mergeUniqueFilesById(state.uploadedFiles, files),
          }),
          false,
          "fileUpload/addFiles",
        ),

      setError: (error: UploadError | null) =>
        set({ error }, false, "fileUpload/setError"),

      clearFiles: () =>
        set({ uploadedFiles: [] }, false, "fileUpload/clearFiles"),

      reset: () => set(initialState, false, "fileUpload/reset"),

      setSilentChatId: (chatId: string | null) =>
        set({ silentChatId: chatId }, false, "fileUpload/setSilentChatId"),
    }),
    {
      name: "File Upload Store",
      store: "file-upload-store",
      enabled: process.env.NODE_ENV === "development",
    },
  ),
);

registerWorkInProgress(() => useFileUploadStore.getState().isUploading);
