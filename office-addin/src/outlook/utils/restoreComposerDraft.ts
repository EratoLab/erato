import type {
  ChatInputControlsHandle,
  FileUploadItem,
} from "@erato/frontend/library";

type RestoreControls = Pick<
  ChatInputControlsHandle,
  "setDraftMessage" | "addUploadedFiles"
>;

/**
 * Puts a draft back after a send was declined. The composer clears itself on
 * handoff; the store's `uploadedFiles` survive that, so files can be re-added.
 */
export function restoreComposerDraft(
  controls: RestoreControls,
  uploadedFiles: FileUploadItem[],
  message: string,
  inputFileIds?: string[],
): void {
  if (message) {
    controls.setDraftMessage(message, { focus: true });
  }

  if (!inputFileIds?.length) return;

  const wanted = new Set(inputFileIds);
  const files = uploadedFiles.filter((file) => wanted.has(file.id));
  if (files.length > 0) {
    controls.addUploadedFiles(files);
  }
}
