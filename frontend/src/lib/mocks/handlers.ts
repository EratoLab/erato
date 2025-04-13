import { http, HttpResponse } from "msw";

import type * as Schemas from "../generated/v1betaApi/v1betaApiSchemas"; // Import schema types if needed

// Define handlers here
export const handlers = [
  // Mock GET /api/v1beta/chats (Deprecated, but kept for existing test)
  http.get("/api/v1beta/chats", () => {
    // Return data matching the ChatsResponse schema (Schemas.Chat[])
    const response: Schemas.Chat[] = [{ id: "chat1" }, { id: "chat2" }];
    return HttpResponse.json(response);
  }),

  // Mock GET /api/v1beta/chats/:chatId/messages
  http.get("/api/v1beta/chats/:chatId/messages", ({ params }) => {
    const { chatId } = params;
    const response: Schemas.ChatMessagesResponse = {
      messages: [
        {
          id: "msg1",
          chat_id: chatId as string,
          role: "user",
          full_text: "Hello",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_message_in_active_thread: true,
          input_files_ids: [],
        },
      ],
      stats: {
        total_count: 1,
        current_offset: 0,
        returned_count: 1,
        has_more: false,
      },
    };
    return HttpResponse.json(response);
  }),

  // Mock GET /api/v1beta/files/:fileId
  http.get("/api/v1beta/files/:fileId", ({ params }) => {
    const { fileId } = params;
    const response: Schemas.FileUploadItem = {
      id: fileId as string,
      filename: "test-file.txt",
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      download_url: `http://localhost/download/${fileId}`,
    };
    return HttpResponse.json(response);
  }),

  // Mock POST /api/v1beta/me/chats
  http.post("/api/v1beta/me/chats", async () => {
    const response: Schemas.CreateChatResponse = {
      chat_id: `new-chat-${Date.now()}`,
    };
    return HttpResponse.json(response);
  }),

  // Mock GET /api/v1beta/me/profile
  http.get("/api/v1beta/me/profile", () => {
    const response: Schemas.UserProfile = {
      id: "user123",
      preferred_language: "en",
      // email, name, picture are nullable/optional
    };
    return HttpResponse.json(response);
  }),

  // Mock GET /api/v1beta/me/recent_chats
  http.get("/api/v1beta/me/recent_chats", () => {
    const response: Schemas.RecentChatsResponse = {
      chats: [
        {
          id: "recent-chat-1",
          title_by_summary: "Recent Chat 1 Title",
          last_message_at: new Date().toISOString(),
          file_uploads: [],
        },
      ],
      stats: {
        total_count: 1,
        current_offset: 0,
        returned_count: 1,
        has_more: false,
      },
    };
    return HttpResponse.json(response);
  }),

  // Mock GET /api/v1beta/messages
  http.get("/api/v1beta/messages", () => {
    const response: Schemas.Message[] = [{ id: "msg1" }, { id: "msg2" }];
    return HttpResponse.json(response);
  }),

  // Mock GET /health
  http.get("/health", () => {
    // Corresponds to fetchHealth expecting `undefined` response body on 200 OK
    return new HttpResponse(null, { status: 200 });
  }),

  // Mock POST /api/v1beta/me/files (Multipart Upload)
  http.post("/api/v1beta/me/files", async ({ request }) => {
    const url = new URL(request.url);
    const chatIdParam = url.searchParams.get("chat_id");

    if (!chatIdParam) {
      return new HttpResponse("Missing chat_id query parameter", {
        status: 400,
      });
    }
    // Now we know chatIdParam is not null
    const chatId = chatIdParam;

    try {
      const formData = await request.formData();
      const files = formData
        .getAll("file")
        .filter((entry): entry is File => entry instanceof File);

      if (files.length === 0) {
        return new HttpResponse("No files found in form data", { status: 400 });
      }

      const uploadedFiles: Schemas.FileUploadItem[] = files.map(
        (file, index) => ({
          id: `uploaded-file-${chatId}-${index}-${Date.now()}`,
          filename: file.name,
          download_url: `http://localhost/download/uploaded-file-${chatId}-${index}`,
        }),
      );

      const response: Schemas.FileUploadResponse = {
        files: uploadedFiles,
      };

      return HttpResponse.json(response);
    } catch (error) {
      console.error("Error processing form data:", error);
      return new HttpResponse("Failed to process form data", { status: 500 });
    }
  }),

  // Add handlers for other endpoints your tests will cover
];
