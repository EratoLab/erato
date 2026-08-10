import type {
  GraphChat,
  GraphChatMessage,
} from "../../../teams/utils/teamsChatGraph";

export const MOCK_CHAT_ID = "19:abc123@thread.v2";

export function mockGraphChat(overrides: Partial<GraphChat> = {}): GraphChat {
  return {
    id: MOCK_CHAT_ID,
    topic: "Product sync",
    chatType: "group",
    lastUpdatedDateTime: "2026-08-10T09:15:00Z",
    members: [
      { id: "m1", displayName: "Ada Lovelace", userId: "u1" },
      { id: "m2", displayName: "Grace Hopper", userId: "u2" },
    ],
    ...overrides,
  };
}

export function mockGraphChatMessage(
  overrides: Partial<GraphChatMessage> = {},
): GraphChatMessage {
  return {
    id: "1741000000000",
    chatId: MOCK_CHAT_ID,
    messageType: "message",
    createdDateTime: "2026-03-03T09:14:00Z",
    from: { user: { id: "u1", displayName: "Ada Lovelace" } },
    body: { contentType: "text", content: "Can we move the sync to Thursday?" },
    ...overrides,
  };
}

/** A `Response` stand-in for the injected transport. */
export function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: () => null },
    json: () => Promise.resolve(payload),
  } as unknown as Response;
}

export function throttledResponse(retryAfterSeconds?: number): Response {
  return {
    ok: false,
    status: 429,
    statusText: "Too Many Requests",
    headers: {
      get: (name: string) =>
        name === "Retry-After" && retryAfterSeconds !== undefined
          ? String(retryAfterSeconds)
          : null,
    },
    json: () => Promise.resolve({}),
  } as unknown as Response;
}
