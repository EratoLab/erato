/**
 * Server-Sent Events (SSE) handler compatible with the API
 * This adapter bridges type mismatches between our app and the generated API
 */

import type { MessageSubmitSseVariables } from "@/lib/generated/v1betaApi/v1betaApiComponents";

/**
 * Type for the message handler that TypeScript likes
 * The key issue is that internally the onMessage function
 * appears to be returning the data which causes a type error
 */
export type MessageHandler = {
  (data: string): void;
};

/**
 * Type representing server-sent event variables with message handling
 */
export interface SSEVariables extends MessageSubmitSseVariables {
  // We make onMessage optional to match the API expectation
  onMessage?: MessageHandler;
  signal?: AbortSignal;
}

/**
 * Direct implementation of SSE fetch that properly handles streaming
 * This bypasses the v1betaApiFetch function that converts responses to blobs
 */
export async function fetchSSE(
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
    signal?: AbortSignal;
    onMessage?: (data: string) => void;
    onError?: (error: Error) => void;
  },
): Promise<void> {
  const { method, headers, body, signal, onMessage, onError } = options;

  console.log("🚀 Direct SSE fetch starting:", { url, method });

  try {
    // Make the fetch request
    const response = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `HTTP error! Status: ${response.status}, Body: ${errorText}`,
      );
    }

    // Check if we have a streaming response
    if (!response.body) {
      throw new Error("Response has no body stream");
    }

    console.log("✅ SSE: Response received, stream available", {
      status: response.status,
      contentType: response.headers.get("content-type"),
    });

    // Set up the reader for the body stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Process the stream
    try {
      let streamComplete = false;
      while (!streamComplete) {
        const { value, done } = await reader.read();

        if (done) {
          console.log("🏁 SSE: Stream complete");
          streamComplete = true;
          continue;
        }

        // Decode the chunk and add to buffer
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        console.log(`📦 SSE: Received chunk (${chunk.length} bytes)`);

        // Process complete SSE events in the buffer
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? ""; // Keep the last incomplete event in the buffer

        for (const line of lines) {
          if (line.trim() === "") continue;

          // Extract the data part from the SSE format (data: {...})
          const dataMatch = line.match(/^data: (.+)$/m);
          if (dataMatch) {
            const eventData = dataMatch[1].trim();
            console.log(
              "📨 SSE: Processed event data:",
              eventData.substring(0, 50) + (eventData.length > 50 ? "..." : ""),
            );

            if (onMessage) {
              onMessage(eventData);
            }
          } else {
            console.warn("⚠️ SSE: Received line without data prefix:", line);
          }
        }
      }
    } catch (streamError) {
      // If we received some data successfully, don't treat this as a fatal error
      // ERR_INCOMPLETE_CHUNKED_ENCODING is expected when streams end abruptly
      if (buffer.length > 0) {
        console.warn(
          "⚠️ SSE: Stream ended unexpectedly but some data was received",
          {
            error: streamError,
            bufferLength: buffer.length,
          },
        );

        // Process any remaining data in the buffer
        if (buffer.trim() !== "") {
          const dataMatch = buffer.match(/^data: (.+)$/m);
          if (dataMatch && onMessage) {
            const eventData = dataMatch[1].trim();
            console.log(
              "📨 SSE: Processing final data from buffer:",
              eventData.substring(0, 50) + (eventData.length > 50 ? "..." : ""),
            );
            onMessage(eventData);
          }
        }

        // Don't re-throw if we had successful data earlier
        return;
      } else {
        // If no data was received, treat as a real error
        console.error("❌ SSE stream error:", streamError);
        throw streamError;
      }
    }
  } catch (error) {
    console.error("❌ SSE fetch error:", error);
    if (onError && error instanceof Error) {
      onError(error);
    }
    throw error;
  }
}

/**
 * Helper function to adapt a void-returning function to work with the SSE API
 * The API internally seems to expect a function that returns the data it was given
 */
export function adaptMessageHandler(
  handler: (data: string) => void,
): (data: string) => unknown {
  return (data: string) => {
    console.log(
      "🔌 SSE: Received event data:",
      data.substring(0, 50) + (data.length > 50 ? "..." : ""),
    );

    // Call the original handler
    handler(data);

    // Return undefined to satisfy TypeScript, the actual implementation expects any
    return undefined;
  };
}

/**
 * Creates an SSE-compatible request with correct typing
 * This helps bridge the gap between our TypeScript types and the runtime API
 */
export function createSSERequest(
  baseRequest: MessageSubmitSseVariables,
  options: {
    onMessage?: (data: string) => void;
    signal?: AbortSignal;
  },
): MessageSubmitSseVariables {
  console.log("🔄 SSE: Creating SSE request", {
    hasBody: !!baseRequest.body,
    hasSignal: !!options.signal,
    hasMessageHandler: !!options.onMessage,
  });

  // Create an adapted handler that will be TypeScript compatible
  const adaptedHandler = options.onMessage
    ? adaptMessageHandler(options.onMessage)
    : undefined;

  // Add a robust onError handler to debug network issues
  const onError = (error: Error | unknown) => {
    console.error("🚨 SSE CONNECTION ERROR:", error);

    // Use a type guard approach to extract error details safely
    const getErrorDetails = (err: unknown) => {
      if (err instanceof Error) {
        return {
          message: err.message,
          type: "Error",
          stack: err.stack,
        };
      }

      if (typeof err === "object" && err !== null) {
        // Try to extract common error properties without explicit casting
        const objError = err as Record<string, unknown>;
        return {
          message:
            typeof objError.message === "string"
              ? objError.message
              : "Unknown error",
          status: objError.status || "N/A",
          type: typeof err,
        };
      }

      return {
        message: "Unknown error",
        type: typeof err,
        status: "N/A",
      };
    };

    console.error("📊 SSE ERROR DETAILS:", getErrorDetails(error));
  };

  // Safety check for the signal - create a simplified signal object if needed
  // This avoids the deep merging issues with the AbortSignal prototype chain
  let safeSignal = undefined;

  if (options.signal && typeof options.signal === "object") {
    try {
      // Instead of passing the full AbortSignal with its prototype chain,
      // create a simplified version with just the essential properties
      safeSignal = {
        aborted: options.signal.aborted,
        reason: options.signal.reason,
        // Explicitly avoid including throwIfAborted which causes issues
        onabort: null,
      };

      console.log("✅ SSE: Created safe signal object", {
        aborted: safeSignal.aborted,
        hasReason: !!safeSignal.reason,
      });
    } catch (err) {
      console.warn("⚠️ SSE: Could not safely process AbortSignal:", err);
    }
  }

  // The actual implementation ignores TypeScript and just combines the objects
  const combined = {
    ...baseRequest,
    signal: safeSignal,
    onMessage: adaptedHandler,
    onError, // Add error handler for network issues
  };

  console.log("📤 SSE: Finalized request", {
    hasOnMessage: !!combined.onMessage,
    hasSignal: !!combined.signal,
    hasErrorHandler: !!combined.onError,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    bodyShape: combined.body ? Object.keys(combined.body) : [],
  });

  // We cast to the expected type to make TypeScript happy while
  // preserving the runtime behavior
  return combined as unknown as MessageSubmitSseVariables;
}
