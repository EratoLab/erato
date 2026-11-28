import { t } from "@lingui/core/macro";

export type AddMenuFileSource = "computer" | "sharepoint";

/** The upload rows' labels, in the composer's menu and in its description. */
export const uploadSourceLabel = (source: AddMenuFileSource): string =>
  source === "computer"
    ? t({
        id: "fileSourceSelector.uploadFromComputer",
        message: "Upload from Computer",
      })
    : t({
        id: "fileSourceSelector.uploadFromOneDrive",
        message: "Upload from Sharepoint",
      });

export const compactChatLabel = (): string =>
  t({ id: "chat.compaction.action", message: "Compact chat history" });
