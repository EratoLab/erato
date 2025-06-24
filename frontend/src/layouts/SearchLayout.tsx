import { Outlet } from "react-router-dom";

import SearchPageStructure from "@/components/ui/Search/SearchPageStructure";
import { RootProvider } from "@/providers/RootProvider";

import type { FileType } from "@/utils/fileTypes";

const ACCEPTED_FILE_TYPES: FileType[] = [
  "pdf",
  "document",
  "text",
  "spreadsheet",
  "image",
];

export default function SearchLayout() {
  return (
    <RootProvider acceptedFileTypes={ACCEPTED_FILE_TYPES}>
      <SearchPageStructure>
        {/* 
          Search page content will be rendered here.
        */}
        <Outlet />
      </SearchPageStructure>
    </RootProvider>
  );
}
