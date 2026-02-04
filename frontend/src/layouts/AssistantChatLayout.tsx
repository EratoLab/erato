import { Outlet } from "react-router-dom";

import { RootProvider } from "@/providers/RootProvider";

export default function AssistantChatLayout() {
  return (
    <RootProvider>
      <div className="flex size-full flex-col bg-theme-bg-primary">
        <Outlet />
      </div>
    </RootProvider>
  );
}
