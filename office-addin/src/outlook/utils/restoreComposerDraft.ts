import type {
  ChatInputControlsHandle,
  FileUploadItem,
} from "@erato/frontend/library";

type RestoreControls = Pick<
  ChatInputControlsHandle,
  "setDraftMessage" | "addUploadedFiles"
>;

/**
 * Puts a draft back into the composer after a send was abandoned.
 *
 * The composer clears its text and attachments synchronously as soon as it
 * hands off, so any send path that decides not to dispatch — a size preflight
 * that resolves its files asynchronously, for one — has already cost the user
 * what they typed. `uploadedFiles` is the upload store's list, which survives
 * that clear because the composer only resets its own state.
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
