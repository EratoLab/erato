import { Outlet } from "react-router-dom";

import AssistantsPageStructure from "@/components/ui/Assistant/AssistantsPageStructure";
import { RootProvider } from "@/providers/RootProvider";

import type { FileType } from "@/utils/fileTypes";

const ACCEPTED_FILE_TYPES: FileType[] = [
  "pdf",
  "document",
  "text",
  "spreadsheet",
  "image",
];

export default function AssistantsLayout() {
  return (
    <RootProvider acceptedFileTypes={ACCEPTED_FILE_TYPES}>
      <AssistantsPageStructure>
        {/* 
          Assistants pages (List, Create, Edit) will be rendered here.
        */}
        <Outlet />
      </AssistantsPageStructure>
    </RootProvider>
  );
}

