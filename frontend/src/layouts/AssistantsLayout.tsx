import { Outlet } from "react-router-dom";

import AssistantsPageStructure from "@/components/ui/Assistant/AssistantsPageStructure";
import { RootProvider } from "@/providers/RootProvider";

export default function AssistantsLayout() {
  return (
    <RootProvider>
      <AssistantsPageStructure>
        {/* 
          Assistants pages (List, Create, Edit) will be rendered here.
        */}
        <Outlet />
      </AssistantsPageStructure>
    </RootProvider>
  );
}
