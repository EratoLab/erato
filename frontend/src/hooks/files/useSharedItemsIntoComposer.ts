import { useEffect, useRef, useState } from "react";

import {
  CombinedUploadError,
  SharedFileWithoutContentError,
  UnsupportedFileTypeError,
  UploadTooLargeError,
  type UploadError,
} from "@/hooks/files/errors";
import { useFileUploadStore } from "@/hooks/files/useFileUploadStore";
import { hostShellWithCapability } from "@/lib/hostShell";
import {
  noSharedItems,
  sortSharedItems,
  type SharedComposerItems,
} from "@/lib/sharedItems";
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
  uploadsEnabled: boolean;
  maxSizeBytes?: number;
  maxSizeFormatted?: string;
}

// The shell forgets items once they are taken. A chat that is replaced while
// it takes or uploads them (New chat remounts it) leaves them here for the
// next one.
let handOver: { items: SharedComposerItems; uploaded: FileUploadItem[] } = {
  items: noSharedItems(),
  uploaded: [],
};

// Chats on screen, woken when a replaced chat leaves items here.
const handOverWatchers = new Set<() => void>();

const leaveForNextChat = (update: () => void) => {
  update();
  for (const wake of handOverWatchers) wake();
};

const hasHandOver = () =>
  handOver.uploaded.length > 0 ||
  Object.values(handOver.items).some((list) => list.length > 0);

/**
 * Puts items shared into the app from other apps (the host shell's `share`
 * capability) into the composer: text into the message field after the
 * draft, files as attachments through the same upload as "+". Nothing is
 * sent. Without the capability this does nothing.
 */
export function useSharedItemsIntoComposer(
  options: UseSharedItemsIntoComposerOptions,
) {
  const { ready } = options;
  const [shell] = useState(() => hostShellWithCapability("share", 1));
  // Items may already wait when the page starts; afterwards the shell says so.
  const [wanted, setWanted] = useState(shell !== null);
  const [busy, setBusy] = useState(false);
  const [handOverCount, setHandOverCount] = useState(0);

  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const wake = () => setHandOverCount((count) => count + 1);
    handOverWatchers.add(wake);
    return () => {
      mounted.current = false;
      handOverWatchers.delete(wake);
    };
  }, []);

  useEffect(() => {
    if (!shell) return;
    return shell.on("share.available", () => setWanted(true));
  }, [shell]);

  useEffect(() => {
    if (!shell || !ready || busy || (!wanted && !hasHandOver())) return;
    const take = wanted;
    setWanted(false);
    setBusy(true);
    void (async () => {
      try {
        if (take) {
          const taken = sortSharedItems(
            await shell.request("share.takePending"),
          );
          const { items } = handOver;
          const merged = {
            texts: [...items.texts, ...taken.texts],
            files: [...items.files, ...taken.files],
            filesWithoutContent: [
              ...items.filesWithoutContent,
              ...taken.filesWithoutContent,
            ],
          };
          if (mounted.current) {
            handOver.items = merged;
          } else {
            leaveForNextChat(() => (handOver.items = merged));
          }
        }
        if (mounted.current) await placeHandOver(latest, mounted);
      } catch (error) {
        logger.warn("Could not take shared items", error);
      } finally {
        if (mounted.current) setBusy(false);
      }
    })();
  }, [shell, ready, wanted, busy, handOverCount]);
}

async function placeHandOver(
  latest: { current: UseSharedItemsIntoComposerOptions },
  mounted: { current: boolean },
) {
  const { items, uploaded } = handOver;
  handOver = { items: noSharedItems(), uploaded: [] };
  const { texts, files, filesWithoutContent } = items;
  const {
    appendToDraft,
    addUploadedFiles,
    uploadFiles,
    uploadsEnabled,
    maxSizeBytes,
    maxSizeFormatted,
  } = latest.current;

  if (texts.length > 0) appendToDraft(texts.join("\n\n"));
  if (uploaded.length > 0) addUploadedFiles(uploaded);

  const reports: UploadError[] = [];
  if (!uploadsEnabled) {
    const names = [...files, ...filesWithoutContent].map((file) => file.name);
    if (names.length > 0) reports.push(new UnsupportedFileTypeError(names));
    report(reports, false);
    return;
  }

  // One upload is all or nothing, so a file over the limit would hold back
  // the photos shared with it; it is named instead, as "+" would name it.
  const isTooLarge = (size: number) =>
    maxSizeBytes !== undefined && size > maxSizeBytes;
  const tooLarge = [...files, ...filesWithoutContent]
    .filter((file) => isTooLarge(file.size))
    .map((file) => file.name);
  const withoutContent = filesWithoutContent
    .filter((file) => !isTooLarge(file.size))
    .map((file) => file.name);
  if (tooLarge.length > 0) {
    reports.push(new UploadTooLargeError(maxSizeFormatted, tooLarge));
  }
  if (withoutContent.length > 0) {
    reports.push(new SharedFileWithoutContentError(withoutContent));
  }

  const toUpload = files.filter((file) => !isTooLarge(file.size));
  if (toUpload.length > 0) {
    const result = await uploadFiles(toUpload);
    if (result && result.length > 0) {
      if (mounted.current) {
        latest.current.addUploadedFiles(result);
      } else {
        leaveForNextChat(() => handOver.uploaded.push(...result));
      }
    }
  }
  report(reports, toUpload.length > 0);
}

// After the upload, which clears the error slot on its way in and may have
// filled it with its own report; that one stays in front.
function report(reports: UploadError[], uploaded: boolean) {
  if (reports.length === 0) return;
  const { error, setError } = useFileUploadStore.getState();
  const all = uploaded && error ? [error, ...reports] : reports;
  setError(all.length === 1 ? all[0] : new CombinedUploadError(all));
}
