import { RootProvider } from "@/providers/RootProvider";

import type { FileType } from "@/utils/fileTypes";

// Set the accepted file types for the chat
const ACCEPTED_FILE_TYPES: FileType[] = [
  "pdf",
  "document",
  "text",
  "spreadsheet",
  "image",
];

// This is a server component
export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RootProvider acceptedFileTypes={ACCEPTED_FILE_TYPES}>
      {children}
    </RootProvider>
  );
}
