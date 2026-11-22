import { afterEach, describe, expect, it } from "vitest";

import { handleSpokenDelta } from "./handleSpokenDelta";
import { handleTextDelta } from "./handleTextDelta";
import { useMessagingStore } from "../store/messagingStore";

const KEY = "__test__";

const reset = () => {
  useMessagingStore.getState().clearAllStreaming();
  useMessagingStore.getState().setActiveStreamKey(KEY);
};

const start = () => {
  reset();
  useMessagingStore
    .getState()
    .setStreaming(
      { isStreaming: true, currentMessageId: "message-1", content: [] },
      KEY,
    );
};

const spoken = (content_index: number, new_text: string) =>
  handleSpokenDelta(
    {
      message_type: "spoken_delta",
      message_id: "message-1",
      content_index,
      new_text,
    },
    KEY,
  );

const text = (content_index: number, new_text: string) =>
  handleTextDelta(
    {
      message_type: "text_delta",
      message_id: "message-1",
      content_index,
      new_text,
    },
    KEY,
  );

const content = () => useMessagingStore.getState().getStreaming(KEY).content;

describe("spoken delta streaming", () => {
  afterEach(reset);

  it("keeps the spoken part apart from the written answer", () => {
    start();
    spoken(0, "Morgen ");
    spoken(0, "um zwei.");
    text(1, "| Tag | Zeit |");

    expect(content()).toEqual([
      { content_type: "spoken", text: "Morgen um zwei." },
      { content_type: "text", text: "| Tag | Zeit |" },
    ]);
  });

  it("turns a spoken part the server demoted into the start of the text", () => {
    start();
    spoken(0, "Das ist ");
    text(0, "eine lange Antwort.");

    expect(content()).toEqual([
      { content_type: "text", text: "Das ist eine lange Antwort." },
    ]);
  });
});
