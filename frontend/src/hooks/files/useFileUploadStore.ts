import { create } from "zustand";

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
   * Error message if upload failed
   */
  error: Error | null;
  /**
   * Stores the chat ID created silently for file uploads
   */
  silentChatId: string | null;
  /**
   * Set the uploading state
   */
  setUploading: (isUploading: boolean) => void;
  /**
   * Add successfully uploaded files to the state
   */
  addFiles: (files: FileUploadItem[]) => void;
  /**
   * Set error state
   */
  setError: (error: Error | null) => void;
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
  error: null,
  silentChatId: null,
};

/**
 * Zustand store for file uploads
 */
export const useFileUploadStore = create<FileUploadState>((set) => ({
  ...initialState,

  setUploading: (isUploading: boolean) => set({ isUploading }),

  addFiles: (files: FileUploadItem[]) =>
    set((state) => ({
      uploadedFiles: [...state.uploadedFiles, ...files],
    })),

  setError: (error: Error | null) => set({ error }),

  clearFiles: () => set({ uploadedFiles: [] }),

  reset: () => set(initialState),

  setSilentChatId: (chatId: string | null) => set({ silentChatId: chatId }),
}));
