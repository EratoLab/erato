import { Outlet } from "react-router-dom";

import ChatPageStructure from "@/app/chat/ChatPageStructure.client";
import { RootProvider } from "@/providers/RootProvider";
// Assuming ChatPageStructure.client.tsx is in src/app/chat/

import type { FileType } from "@/utils/fileTypes";

const ACCEPTED_FILE_TYPES: FileType[] = [
  "pdf",
  "document",
  "text",
  "spreadsheet",
  "image",
];

export default function ChatLayout() {
  return (
    <RootProvider acceptedFileTypes={ACCEPTED_FILE_TYPES}>
      <ChatPageStructure>
        {/* 
          Child routes (NewChatPage, ChatDetailPage) will be rendered here. 
          They primarily handle logic and return null, while ChatPageStructure renders the UI.
        */}
        <Outlet />
      </ChatPageStructure>
    </RootProvider>
  );
} 