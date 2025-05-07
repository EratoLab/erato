// No "use client" directive here, making this a Server Component by default

import { ChatProvider } from "@/providers/ChatProvider";
import { RootProvider } from "@/providers/RootProvider";

import ChatPageStructure from "./ChatPageStructure.client"; // Import the client component

import type { FileType } from "@/utils/fileTypes";

// ACCEPTED_FILE_TYPES remains here as it's static configuration for RootProvider
const ACCEPTED_FILE_TYPES: FileType[] = [
  "pdf",
  "document",
  "text",
  "spreadsheet",
  "image",
];

// This is the new default export for the layout (Server Component)
export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The logger related to ChatPageStructure has moved to that file
  return (
    <RootProvider acceptedFileTypes={ACCEPTED_FILE_TYPES}>
      <ChatProvider>
        <ChatPageStructure>{children}</ChatPageStructure>
      </ChatProvider>
    </RootProvider>
  );
}
