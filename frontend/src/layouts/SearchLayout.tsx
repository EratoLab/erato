import { Outlet } from "react-router-dom";

import SearchPageStructure from "@/components/ui/Search/SearchPageStructure";
import { RootProvider } from "@/providers/RootProvider";

export default function SearchLayout() {
  return (
    <RootProvider>
      <SearchPageStructure>
        {/* 
          Search page content will be rendered here.
        */}
        <Outlet />
      </SearchPageStructure>
    </RootProvider>
  );
}
