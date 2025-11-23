import { Outlet } from "react-router-dom";

import { RootProvider } from "@/providers/RootProvider";

import type { FileType } from "@/utils/fileTypes";

const ACCEPTED_FILE_TYPES: FileType[] = [
  "pdf",
  "document",
  "text",
  "spreadsheet",
  "image",
];

export default function AssistantChatLayout() {
  return (
    <RootProvider acceptedFileTypes={ACCEPTED_FILE_TYPES}>
      <div className="flex size-full flex-col bg-theme-bg-primary">
        <Outlet />
      </div>
    </RootProvider>
  );
}
