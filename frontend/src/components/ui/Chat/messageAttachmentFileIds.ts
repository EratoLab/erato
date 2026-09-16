import type { UiChatMessage } from "@/utils/adapters/messageAdapter";

/**
 * Every file a message shows as an attachment, in the order it attached them.
 *
 * An assistant message carries the documents its generation produced as
 * `text_file_pointer` parts rather than in `input_files_ids`, so an attachment
 * list built from the ids alone silently drops them. The union is deduplicated
 * because one generation can both receive and hand back the same file, and the
 * pointer half is assistant-only: on a user message a pointer echoes an upload
 * that `input_files_ids` already names.
 *
 * Its own module rather than a member of either caller: `ChatMessage` replaces
 * the whole attachments module in its tests, so a second export there would
 * break every one of them, and importing this back out of `ChatMessage` would
 * close a cycle.
 */
export const messageAttachmentFileIds = (message: UiChatMessage): string[] => [
  ...new Set([
    ...(message.input_files_ids ?? []),
    ...(message.role !== "user"
      ? message.content.flatMap((part) =>
          part.content_type === "text_file_pointer"
            ? [part.file_upload_id]
            : [],
        )
      : []),
  ]),
];
