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
 * Helper function to adapt a void-returning function to work with the SSE API
 * The API internally seems to expect a function that returns the data it was given
 */
export function adaptMessageHandler(
  handler: (data: string) => void,
): (data: string) => unknown {
  return (data: string) => {
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
  // Create an adapted handler that will be TypeScript compatible
  const adaptedHandler = options.onMessage
    ? adaptMessageHandler(options.onMessage)
    : undefined;

  // The actual implementation ignores TypeScript and just combines the objects
  const combined = {
    ...baseRequest,
    signal: options.signal,
    onMessage: adaptedHandler,
  };

  // We cast to the expected type to make TypeScript happy while
  // preserving the runtime behavior
  return combined as unknown as MessageSubmitSseVariables;
}
