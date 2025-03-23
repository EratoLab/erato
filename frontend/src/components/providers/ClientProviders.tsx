"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { ThemeProvider } from "./ThemeProvider";
import { SidebarProvider } from "../../contexts/SidebarContext";
import { ChatHistoryProvider } from "../containers/ChatHistoryProvider";
import { MessageStreamProvider } from "../containers/MessageStreamProvider";
import { ProfileProvider } from "../containers/ProfileProvider";

import type { PropsWithChildren } from "react";

// Helper component to connect ChatHistoryProvider with MessageStreamProvider
const ChatBridge: React.FC<PropsWithChildren> = ({ children }) => {
  return (
    <MessageStreamProvider
      onChatCreated={(tempId, permanentId) => {
        // This will be connected properly in the chat history provider
        if (typeof window !== "undefined") {
          // Access the ChatHistoryContext safely on client side
          const chatHistoryContext = (
            window as Window & {
              __CHAT_HISTORY_CONTEXT__?: {
                confirmSession?: (tempId: string, permanentId: string) => void;
              };
            }
          ).__CHAT_HISTORY_CONTEXT__;
          if (chatHistoryContext?.confirmSession) {
            chatHistoryContext.confirmSession(tempId, permanentId);
          }
        }
      }}
    >
      {children}
    </MessageStreamProvider>
  );
};

export function ClientProviders({ children }: PropsWithChildren) {
  // Create a client that can be shared across the app with proper configuration
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 1000, // 5 seconds
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SidebarProvider>
          <ProfileProvider>
            <ChatHistoryProvider>
              <ChatBridge>
                <div className="flex h-screen min-h-screen bg-theme-bg-primary">
                  {children}
                </div>
              </ChatBridge>
            </ChatHistoryProvider>
          </ProfileProvider>
        </SidebarProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
