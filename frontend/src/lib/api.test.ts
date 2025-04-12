import { describe, it, expect, vi } from "vitest";

import {
  fetchChats,
  fetchChatMessages,
  fetchGetFile,
  fetchCreateChat,
  fetchProfile,
  fetchRecentChats,
  fetchMessages,
  fetchHealth,
  fetchUploadFile,
  type UploadFileVariables,
} from "./generated/v1betaApi/v1betaApiComponents";
import * as fetcher from "./generated/v1betaApi/v1betaApiFetcher";

import type {
  Chat,
  ChatMessagesResponse,
  FileUploadItem,
  CreateChatResponse,
  UserProfile,
  RecentChatsResponse,
  Message,
  FileUploadResponse,
} from "./generated/v1betaApi/v1betaApiSchemas";

// Import the fetcher module to spy on its export

describe("API Client Tests", () => {
  it("fetchChats should fetch chats correctly (Deprecated Endpoint)", async () => {
    const variables = {};
    try {
      const chats: Chat[] = await fetchChats(variables);
      expect(chats).toBeInstanceOf(Array);
      expect(chats.length).toBe(2);
      expect(chats[0].id).toBe("chat1");
    } catch (error) {
      console.error("API call failed:", error);
      expect(error).toBeUndefined();
    }
  });

  it("fetchChatMessages should fetch messages for a chat", async () => {
    const variables = { pathParams: { chatId: "test-chat-id" } };
    try {
      const response: ChatMessagesResponse = await fetchChatMessages(variables);
      expect(response.messages).toBeInstanceOf(Array);
      expect(response.messages.length).toBe(1);
      expect(response.messages[0].id).toBe("msg1");
      expect(response.messages[0].chat_id).toBe("test-chat-id");
      expect(response.stats.total_count).toBe(1);
    } catch (error) {
      console.error("API call failed:", error);
      expect(error).toBeUndefined();
    }
  });

  it("fetchGetFile should fetch a single file", async () => {
    const variables = { pathParams: { fileId: "test-file-id" } };
    try {
      const response: FileUploadItem = await fetchGetFile(variables);
      expect(response.id).toBe("test-file-id");
      expect(response.filename).toBe("test-file.txt");
    } catch (error) {
      console.error("API call failed:", error);
      expect(error).toBeUndefined();
    }
  });

  it("fetchCreateChat should create a new chat", async () => {
    const variables = {}; // Body might be optional/empty for this endpoint
    try {
      const response: CreateChatResponse = await fetchCreateChat(variables);
      expect(response.chat_id).toMatch(/^new-chat-\d+$/);
    } catch (error) {
      console.error("API call failed:", error);
      expect(error).toBeUndefined();
    }
  });

  it("fetchProfile should fetch the user profile", async () => {
    const variables = {};
    try {
      const response: UserProfile = await fetchProfile(variables);
      expect(response.id).toBe("user123");
      expect(response.preferred_language).toBe("en");
    } catch (error) {
      console.error("API call failed:", error);
      expect(error).toBeUndefined();
    }
  });

  it("fetchRecentChats should fetch recent chats", async () => {
    const variables = {}; // Query params (limit/offset) are optional
    try {
      const response: RecentChatsResponse = await fetchRecentChats(variables);
      expect(response.chats).toBeInstanceOf(Array);
      expect(response.chats.length).toBe(1);
      expect(response.chats[0].id).toBe("recent-chat-1");
      expect(response.stats.total_count).toBe(1);
    } catch (error) {
      console.error("API call failed:", error);
      expect(error).toBeUndefined();
    }
  });

  it("fetchMessages should fetch messages (Example Endpoint)", async () => {
    const variables = {};
    try {
      const response: Message[] = await fetchMessages(variables);
      expect(response).toBeInstanceOf(Array);
      expect(response.length).toBe(2);
      expect(response[0].id).toBe("msg1");
    } catch (error) {
      console.error("API call failed:", error);
      expect(error).toBeUndefined();
    }
  });

  it("fetchHealth should complete successfully for health check", async () => {
    const variables = {};
    try {
      // Await the function. If it rejects (throws), the catch block will fail the test.
      await fetchHealth(variables);
      // If we reach here, the promise resolved successfully.
      // No need to check the resolved value (undefined vs Blob) if we only care about success.
      expect(true).toBe(true); // Explicit assertion for successful completion
    } catch (error) {
      // If any error occurs during the fetch itself, fail the test.
      console.error("fetchHealth test failed with error:", error);
      expect.fail(`fetchHealth threw an error: ${String(error)}`);
    }
  });

  it(
    "fetchUploadFile should call fetcher and return mocked response",
    { timeout: 15000 },
    async () => {
      // 1. Define the mock response
      const mockFileName = "mock-upload.txt";
      const mockResponse: FileUploadResponse = {
        files: [
          {
            id: "mock-id-123",
            filename: mockFileName,
            download_url: "http://mock.download/mock-id-123",
          },
        ],
      };

      // Spy on and mock v1betaApiFetch just for this test
      const fetchSpy = vi
        .spyOn(fetcher, "v1betaApiFetch")
        .mockResolvedValue(mockResponse); // Directly resolve with the mock response

      // 2. Create mock file and variables
      const fileContent = "This is the file content.";
      const mockFile = new File([fileContent], mockFileName, {
        type: "text/plain",
      });
      const formData = new FormData();
      formData.append("file", mockFile, mockFileName);

      const variables = {
        queryParams: { chat_id: "upload-chat-id" },
        body: formData as unknown,
        headers: {
          "Content-Type": "multipart/form-data",
        },
      };

      try {
        // 3. Call the function
        const response: FileUploadResponse = await fetchUploadFile(
          variables as UploadFileVariables,
        );

        // 4. Assert the response came from the mock
        expect(response).toEqual(mockResponse);

        // 5. Assert that the spy was called correctly
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const callOptions = fetchSpy.mock.calls[0][0];
        expect(callOptions.url).toBe("/api/v1beta/me/files");
        expect(callOptions.method).toBe("post");
        expect(callOptions.body).toBeInstanceOf(FormData);
        expect(callOptions.queryParams).toEqual({ chat_id: "upload-chat-id" });
        expect(callOptions.headers).toEqual({
          "Content-Type": "multipart/form-data",
        });
      } catch (error) {
        console.error("fetchUploadFile test failed with error:", error);
        expect.fail(`fetchUploadFile threw an error: ${String(error)}`);
      } finally {
        // Restore the original implementation after the test
        fetchSpy.mockRestore();
      }
    },
  );
});
