import { http, delay, HttpResponse } from "msw";
import { setupServer } from "msw/node";

// Create and export the server
export const server = setupServer();

// Setup/teardown hooks for tests
export function setupMSW() {
  // Start server before all tests
  beforeAll(() => server.listen());

  // Reset handlers between tests
  afterEach(() => server.resetHandlers());

  // Clean up after tests
  afterAll(() => server.close());
}

// Helper function to create SSE readable stream
export function createSSEStreamBody(
  events: Array<{
    type: string;
    data: Record<string, unknown>;
    delay: number;
  }>,
) {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      for (const event of events) {
        // Wait for specified delay to simulate network latency
        await new Promise((resolve) => setTimeout(resolve, event.delay));

        // Format as SSE event
        const data = JSON.stringify({
          message_type: event.type,
          ...event.data,
        });

        // Send the event in SSE format
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }
      controller.close();
    },
  });
}

// Handler factory for chat SSE streaming
export function createSSEStreamHandler(chatId: string, messageParts: string[]) {
  return http.post(
    "/api/v1beta/me/messages/submitstream",
    async ({ request }) => {
      // Get user message from request body
      let userMessage = "";
      try {
        const body = (await request.json()) as { user_message?: string };
        userMessage = body.user_message ?? "";
      } catch (error) {
        console.error("Error parsing request body:", error);
      }

      // Create a stream for our events
      const stream = new TransformStream();
      const writer = stream.writable.getWriter();
      const encoder = new TextEncoder();

      // Process event creation in the background
      const processEvents = async () => {
        try {
          // Chat created event
          await delay(10);
          await writer.write(
            encoder.encode(
              `data: ${JSON.stringify({
                message_type: "chat_created",
                chat_id: chatId,
              })}\n\n`,
            ),
          );

          // User message saved event
          await delay(20);
          await writer.write(
            encoder.encode(
              `data: ${JSON.stringify({
                message_type: "user_message_saved",
                message_id: "user-msg-123",
                message: {
                  id: "user-msg-123",
                  chat_id: chatId,
                  role: "user",
                  full_text: userMessage,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  is_message_in_active_thread: true,
                },
              })}\n\n`,
            ),
          );

          // Process each text delta
          let accumulatedText = "";
          for (let i = 0; i < messageParts.length; i++) {
            await delay(30);
            accumulatedText += messageParts[i];
            await writer.write(
              encoder.encode(
                `data: ${JSON.stringify({
                  message_type: "text_delta",
                  new_text: messageParts[i],
                })}\n\n`,
              ),
            );
          }

          // Complete message event
          await delay(40);
          await writer.write(
            encoder.encode(
              `data: ${JSON.stringify({
                message_type: "message_complete",
                message_id: "assistant-msg-456",
                full_text: accumulatedText,
                message: {
                  id: "assistant-msg-456",
                  chat_id: chatId,
                  role: "assistant",
                  full_text: accumulatedText,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  is_message_in_active_thread: true,
                },
              })}\n\n`,
            ),
          );

          await writer.close();
        } catch (error) {
          console.error("Error in MSW stream handler:", error);
          void writer.abort(error as Error);
        }
      };

      // Start the event processing
      void processEvents();

      return new HttpResponse(stream.readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    },
  );
}
