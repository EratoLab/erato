import { useEffect, useRef, useState } from "react";

import {
  SharedFileWithoutContentError,
  UploadTooLargeError,
} from "@/hooks/files/errors";
import { useFileUploadStore } from "@/hooks/files/useFileUploadStore";
import { hostShellWithCapability } from "@/lib/hostShell";
import { sortSharedItems } from "@/lib/sharedItems";
import { createLogger } from "@/utils/debugLogger";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const logger = createLogger("UI", "useSharedItemsIntoComposer");

interface UseSharedItemsIntoComposerOptions {
  /**
   * Whether the composer can take items now. The shell keeps them until they
   * are taken, so a closed composer or a running upload only delays them.
   */
  ready: boolean;
  uploadFiles: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  addUploadedFiles: (files: FileUploadItem[]) => void;
  appendToDraft: (block: string) => void;
  maxSizeBytes?: number;
  maxSizeFormatted?: string;
}

/**
 * Puts items shared into the app from other apps (the host shell's `share`
 * capability) into the composer: text into the message field after the
 * draft, files as attachments through the same upload as "+". Nothing is
 * sent. Without the capability this does nothing.
 */
export function useSharedItemsIntoComposer({
  ready,
  uploadFiles,
  addUploadedFiles,
  appendToDraft,
  maxSizeBytes,
  maxSizeFormatted,
}: UseSharedItemsIntoComposerOptions) {
  const [shell] = useState(() => hostShellWithCapability("share", 1));
  const setUploadError = useFileUploadStore((state) => state.setError);
  // Items may already wait when the page starts; afterwards the shell says so.
  const [wanted, setWanted] = useState(shell !== null);
  const [taking, setTaking] = useState(false);

  const latest = useRef({
    uploadFiles,
    addUploadedFiles,
    appendToDraft,
    maxSizeBytes,
    maxSizeFormatted,
    setUploadError,
  });
  useEffect(() => {
    latest.current = {
      uploadFiles,
      addUploadedFiles,
      appendToDraft,
      maxSizeBytes,
      maxSizeFormatted,
      setUploadError,
    };
  });

  useEffect(() => {
    if (!shell) return;
    return shell.on("share.available", () => setWanted(true));
  }, [shell]);

  useEffect(() => {
    if (!shell || !ready || !wanted || taking) return;
    setWanted(false);
    setTaking(true);
    void (async () => {
      try {
        const result = await shell.request("share.takePending");
        await putIntoComposer(sortSharedItems(result), latest.current);
      } catch (error) {
        logger.warn("Could not take shared items", error);
      } finally {
        setTaking(false);
      }
    })();
  }, [shell, ready, wanted, taking]);
}

async function putIntoComposer(
  { texts, files, filesWithoutContent }: ReturnType<typeof sortSharedItems>,
  {
    uploadFiles,
    addUploadedFiles,
    appendToDraft,
    maxSizeBytes,
    maxSizeFormatted,
    setUploadError,
  }: Omit<UseSharedItemsIntoComposerOptions, "ready"> & {
    setUploadError: (
      error: SharedFileWithoutContentError | UploadTooLargeError,
    ) => void;
  },
) {
  if (texts.length > 0) {
    appendToDraft(texts.join("\n\n"));
  }

  // One upload is all or nothing, so a file over the limit would hold back
  // the photos shared with it; it is named instead, as "+" would name it.
  const isTooLarge = (size: number) =>
    maxSizeBytes !== undefined && size > maxSizeBytes;
  const tooLarge = [
    ...files.filter((file) => isTooLarge(file.size)).map((file) => file.name),
    ...filesWithoutContent
      .filter((file) => isTooLarge(file.size))
      .map((file) => file.name),
  ];
  const withoutContent = filesWithoutContent
    .filter((file) => !isTooLarge(file.size))
    .map((file) => file.name);
  const toUpload = files.filter((file) => !isTooLarge(file.size));

  if (toUpload.length > 0) {
    const uploaded = await uploadFiles(toUpload);
    if (uploaded && uploaded.length > 0) {
      addUploadedFiles(uploaded);
    }
  }

  // After the upload, which clears the error slot on its way in.
  if (tooLarge.length > 0) {
    setUploadError(new UploadTooLargeError(maxSizeFormatted, tooLarge));
  } else if (withoutContent.length > 0) {
    setUploadError(new SharedFileWithoutContentError(withoutContent));
  }
}
