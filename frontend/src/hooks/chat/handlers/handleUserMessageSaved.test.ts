import { beforeEach, describe, expect, it } from "vitest";

import { handleUserMessageSaved } from "./handleUserMessageSaved";
import {
  NEW_CHAT_STREAM_KEY,
  useMessagingStore,
} from "../store/messagingStore";

import type { MessageSubmitStreamingResponseUserMessageSaved } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

const STREAM_KEY = "chat-1";
const SERVER_ID = "11111111-1111-1111-1111-111111111111";
const CREATED_AT = "2026-07-21T10:00:00.000Z";

function savedEvent(text = "hello") {
  return {
    message_type: "user_message_saved",
    message_id: SERVER_ID,
    message: {
      id: SERVER_ID,
      chat_id: STREAM_KEY,
      role: "user",
      content: [{ content_type: "text", text }],
      created_at: CREATED_AT,
    },
  } as unknown as MessageSubmitStreamingResponseUserMessageSaved & {
    message_type: "user_message_saved";
  };
}

function seedUserMessages(messages: Message[]) {
  useMessagingStore.setState({
    userMessagesByKey: {
      [STREAM_KEY]: Object.fromEntries(messages.map((m) => [m.id, m])),
    },
  });
}

function userMessagesForKey() {
  return useMessagingStore.getState().userMessagesByKey[STREAM_KEY] ?? {};
}

describe("handleUserMessageSaved", () => {
  beforeEach(() => {
    useMessagingStore.setState({
      activeStreamKey: STREAM_KEY,
      streamKeyAliases: {},
      userMessages: {},
      userMessagesByKey: {},
      streamingByKey: {},
    });
  });

  it("replaces the optimistic message with the server copy", () => {
    seedUserMessages([
      {
        id: "temp-user-1",
        content: [{ content_type: "text", text: "hello" }],
        role: "user",
        createdAt: "2026-07-21T09:59:59.000Z",
        status: "sending",
      },
    ]);

    handleUserMessageSaved(savedEvent(), STREAM_KEY);

    const userMessages = userMessagesForKey();
    expect(Object.keys(userMessages)).toEqual([SERVER_ID]);
    expect(userMessages[SERVER_ID]).toMatchObject({
      status: "complete",
      createdAt: CREATED_AT,
    });
  });

  it("inserts the server copy when there is no optimistic message to reconcile", () => {
    handleUserMessageSaved(savedEvent(), STREAM_KEY);

    const userMessages = userMessagesForKey();
    expect(Object.keys(userMessages)).toEqual([SERVER_ID]);
    expect(userMessages[SERVER_ID]).toMatchObject({
      role: "user",
      status: "complete",
      createdAt: CREATED_AT,
    });
    expect(useMessagingStore.getState().userMessages).toEqual(userMessages);
  });

  it("does not duplicate when the same event is delivered twice", () => {
    handleUserMessageSaved(savedEvent(), STREAM_KEY);
    handleUserMessageSaved(savedEvent(), STREAM_KEY);

    expect(Object.keys(userMessagesForKey())).toEqual([SERVER_ID]);
  });

  it("leaves the active-key mirror alone for a background stream", () => {
    useMessagingStore.setState({ activeStreamKey: NEW_CHAT_STREAM_KEY });

    handleUserMessageSaved(savedEvent(), STREAM_KEY);

    expect(Object.keys(userMessagesForKey())).toEqual([SERVER_ID]);
    expect(useMessagingStore.getState().userMessages).toEqual({});
  });
});
