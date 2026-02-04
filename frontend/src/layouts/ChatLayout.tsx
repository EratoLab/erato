import { Outlet } from "react-router-dom";

import ChatPageStructure from "@/app/chat/ChatPageStructure.client";
import { RootProvider } from "@/providers/RootProvider";
// Assuming ChatPageStructure.client.tsx is in src/app/chat/

export default function ChatLayout() {
  return (
    <RootProvider>
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
