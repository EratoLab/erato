import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useModelHistory } from "../useModelHistory";

import type { RecentChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useAvailableModels: () => ({
    data: [{ chat_provider_id: "available-model" }],
  }),
}));

describe("useModelHistory", () => {
  it.each([false, true])("restores the last model (pinned: %s)", (isPinned) => {
    const chat: RecentChat = {
      id: "chat-1",
      title_resolved: "Chat",
      can_edit: true,
      file_uploads: [],
      is_pinned: isPinned,
      last_message_at: "2026-09-08T12:00:00Z",
      last_model: {
        chat_provider_id: "available-model",
        model_display_name: "Available model",
      },
    };
    const { result } = renderHook(() =>
      useModelHistory({
        currentChatId: chat.id,
        chats: isPinned ? [] : [chat],
        pinnedChats: isPinned ? [chat] : [],
      }),
    );

    expect(result.current.currentChatLastModel).toEqual(chat.last_model);
  });
});
