import { faker } from "@faker-js/faker/locale/en";

import type {
  ChatMessage,
  RecentChat,
  UserProfile,
  RecentChatsResponse,
  ChatMessagesResponse,
  ContentPartText,
} from "../lib/generated/v1betaApi/v1betaApiSchemas";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Utility class to generate mock data for tests and Storybook
 * that matches the API response types
 */
export class MockDataGenerator {
  /**
   * Generate a unique ID
   */
  private static generateId(): string {
    return `msg_${faker.string.uuid()}`;
  }

  /**
   * Generate realistic English text instead of Lorem Ipsum
   */
  private static generateRealisticText(): string {
    // Assistant messages are more formal and informative
    return `${faker.hacker.phrase()} ${faker.company.catchPhrase()}`;
  }

  /**
   * Generate a mock user profile
   */
  static createUserProfile(overrides?: Partial<UserProfile>): UserProfile {
    return {
      id: overrides?.id ?? `user_${faker.string.uuid()}`,
      name: undefined,
      email: undefined,
      picture: undefined,
      preferred_language: overrides?.preferred_language ?? "en",
      groups: [],
      organization_group_ids: [],
      ...overrides,
    };
  }

  /**
   * Generate a mock assistant profile
   */
  static createAssistantProfile(overrides?: Partial<UserProfile>): UserProfile {
    return {
      id: overrides?.id ?? "assistant_1",
      name: undefined,
      email: undefined,
      picture: undefined,
      preferred_language: overrides?.preferred_language ?? "en",
      groups: [],
      organization_group_ids: [],
      ...overrides,
    };
  }

  /**
   * Creates a realistic mock chat message
   * @param chatId The ID of the chat this message belongs to
   * @param role The role of the message sender
   * @param overrides Optional properties to override
   * @returns A mock ChatMessage
   */
  static createMockChatMessage(
    chatId: string,
    role: "user" | "assistant" | "system" = "user",
    overrides?: Partial<ChatMessage>,
  ): ChatMessage {
    const messageText =
      overrides?.content?.[0]?.content_type === "text"
        ? (overrides.content[0] as ContentPartText).text
        : this.generateRealisticText();

    return {
      id: this.generateId(),
      chat_id: chatId,
      role,
      content: [
        {
          content_type: "text",
          text: messageText,
        },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      input_files_ids: [],
      is_message_in_active_thread: true,
      previous_message_id: undefined,
      sibling_message_id: undefined,
      ...overrides,
    };
  }

  /**
   * Generate a mock recent chat
   */
  static createRecentChat(
    id?: string,
    overrides?: Partial<RecentChat>,
  ): RecentChat {
    const chatId = id ?? `chat_${faker.string.uuid()}`;

    return {
      id: chatId,
      title_by_summary:
        overrides?.title_by_summary ?? faker.company.catchPhrase(),
      last_message_at: overrides?.last_message_at ?? new Date().toISOString(),
      file_uploads: overrides?.file_uploads ?? [],
      can_edit: overrides?.can_edit ?? true,
    };
  }

  /**
   * Generate a complete set of mock data for chats and messages
   */
  static createMockDataset(chatCount = 5, messagesPerChat = 10) {
    // Create user profiles
    const userProfile = this.createUserProfile({ id: "user_1" });
    const assistantProfile = this.createAssistantProfile({ id: "assistant_1" });

    // Create chats and their messages
    const chats: RecentChat[] = [];
    const allMessages: Record<string, ChatMessage[]> = {};

    for (let i = 0; i < chatCount; i++) {
      const chatId = `chat_${i + 1}`;
      const chat = this.createRecentChat(chatId);
      chats.push(chat);

      // Create messages for this chat
      const messages: ChatMessage[] = [];
      for (let j = 0; j < messagesPerChat; j++) {
        const role = j % 2 === 0 ? "user" : "assistant";

        // Calculate message creation time based on index for realistic time ordering
        const messageDate = new Date();
        messageDate.setMinutes(
          messageDate.getMinutes() - (messagesPerChat - j),
        );

        const message = this.createMockChatMessage(chatId, role, {
          id: `msg_${chatId}_${j + 1}`,
          created_at: messageDate.toISOString(),
          updated_at: messageDate.toISOString(),
        });
        messages.push(message);
      }

      allMessages[chatId] = messages;
    }

    return {
      profiles: {
        user: userProfile,
        assistant: assistantProfile,
      },
      chats,
      messages: allMessages,

      // Helper method to get formatted responses matching the API
      getRecentChatsResponse(): RecentChatsResponse {
        return {
          chats: chats,
          stats: {
            total_count: chats.length,
            returned_count: chats.length,
            current_offset: 0,
            has_more: false,
          },
        };
      },

      getChatMessagesResponse(chatId: string): ChatMessagesResponse {
        const chatMessages = allMessages[chatId] ?? [];
        return {
          messages: chatMessages,
          stats: {
            total_count: chatMessages.length,
            returned_count: chatMessages.length,
            current_offset: 0,
            has_more: false,
          },
        };
      },
    };
  }

  /**
   * Populate a QueryClient with mock data for the profile endpoint
   */
  static populateQueryClientWithProfile(
    queryClient: QueryClient,
    userProfile: UserProfile,
  ): void {
    // Primary query key format
    queryClient.setQueryData(["api", "v1beta", "me", "profile"], userProfile);

    // Legacy/fallback formats
    queryClient.setQueryData(["profile"], userProfile);
    queryClient.setQueryData(
      [{ path: "/api/v1beta/me/profile", operationId: "profile" }],
      userProfile,
    );
  }

  /**
   * Populate a QueryClient with mock data for the recent chats endpoint
   * including common query parameter variations
   */
  static populateQueryClientWithRecentChats(
    queryClient: QueryClient,
    recentChatsResponse: RecentChatsResponse,
  ): void {
    // Base query key (no params)
    queryClient.setQueryData(
      ["api", "v1beta", "me", "recent_chats"],
      recentChatsResponse,
    );

    // Common limit values
    [10, 20, 50, 100].forEach((limit) => {
      queryClient.setQueryData(
        ["api", "v1beta", "me", "recent_chats", { limit }],
        recentChatsResponse,
      );
    });

    // Common limit and offset combinations
    [0, 10, 20].forEach((offset) => {
      [10, 20, 50].forEach((limit) => {
        queryClient.setQueryData(
          ["api", "v1beta", "me", "recent_chats", { limit, offset }],
          recentChatsResponse,
        );
      });
    });

    // Legacy/fallback format
    queryClient.setQueryData(["chatHistory"], {
      chats: recentChatsResponse.chats,
      totalCount: recentChatsResponse.stats.total_count,
      hasMore: recentChatsResponse.stats.has_more,
    });
  }

  /**
   * Populate a QueryClient with mock data for chat messages
   * including common query parameter variations
   */
  static populateQueryClientWithChatMessages(
    queryClient: QueryClient,
    chatId: string,
    messagesResponse: ChatMessagesResponse,
  ): void {
    // Base query key (no params)
    queryClient.setQueryData(
      ["api", "v1beta", "chats", chatId, "messages"],
      messagesResponse,
    );

    // With typical query params
    [6, 10, 20, 50, 100].forEach((limit) => {
      queryClient.setQueryData(
        ["api", "v1beta", "chats", chatId, "messages", { limit }],
        messagesResponse,
      );

      // Also set combinations of limit and offset
      [0, 6, 10, 20].forEach((offset) => {
        queryClient.setQueryData(
          ["api", "v1beta", "chats", chatId, "messages", { limit, offset }],
          messagesResponse,
        );
      });
    });

    // Support the alternate query format with sessionId parameter
    queryClient.setQueryData(
      ["api", "v1beta", "messages", { sessionId: chatId }],
      messagesResponse,
    );

    // Support alternate formats with sessionId and other params
    [6, 10, 20, 50].forEach((limit) => {
      queryClient.setQueryData(
        ["api", "v1beta", "messages", { sessionId: chatId, limit }],
        messagesResponse,
      );

      // With offset
      [0, 6, 10].forEach((offset) => {
        queryClient.setQueryData(
          ["api", "v1beta", "messages", { sessionId: chatId, limit, offset }],
          messagesResponse,
        );
      });
    });
  }

  /**
   * Populate an entire QueryClient with a complete dataset
   * This is a convenience method for Storybook and tests
   */
  static populateQueryClient(
    queryClient: QueryClient,
    mockData: ReturnType<typeof this.createMockDataset>,
  ): void {
    // Populate profile data
    this.populateQueryClientWithProfile(queryClient, mockData.profiles.user);

    // Populate recent chats
    this.populateQueryClientWithRecentChats(
      queryClient,
      mockData.getRecentChatsResponse(),
    );

    // Populate messages for each chat
    mockData.chats.forEach((chat) => {
      this.populateQueryClientWithChatMessages(
        queryClient,
        chat.id,
        mockData.getChatMessagesResponse(chat.id),
      );
    });

    // Add additional common settings
    queryClient.setQueryData(["systemSettings"], {
      allowRegistration: true,
      maxAttachmentSize: 5 * 1024 * 1024, // 5MB
      supportedFileTypes: ["image/png", "image/jpeg", "application/pdf"],
      maintenanceMode: false,
    });

    queryClient.setQueryData(["userPreferences"], {
      theme: "light",
      notifications: true,
      language: "en",
    });
  }
}
