import { describe, expect, it } from "vitest";

import { wordMessageContext } from "../wordMessageContext";

import type { Message } from "@erato/frontend/library";

const text = (value: string) => [
  { content_type: "text" as const, text: value },
];

const request: Message = {
  id: "user-1",
  role: "user",
  content: text("Change ALPHA-7 to BRAVO-9."),
  createdAt: "2026-11-23T20:57:09Z",
  action_facet_args: { document_identity: "C:\\docs\\approval-test.docx" },
};

describe("wordMessageContext", () => {
  it("reads the request through the stored link", () => {
    const answer: Message = {
      id: "answer-1",
      role: "assistant",
      content: [],
      createdAt: "2026-11-23T20:57:10Z",
      previous_message_id: "user-1",
    };
    expect(
      wordMessageContext(
        { "user-1": request, "answer-1": answer },
        ["user-1", "answer-1"],
        "answer-1",
      ),
    ).toMatchObject({
      identity: "C:\\docs\\approval-test.docx",
      requestText: "Change ALPHA-7 to BRAVO-9.",
    });
  });

  it("finds the request of an answer that streams again after a reload", () => {
    const earlier: Message = {
      ...request,
      id: "user-0",
      content: text("An earlier request."),
      createdAt: "2026-11-23T20:50:00Z",
    };
    const streaming: Message = {
      id: "answer-1",
      role: "assistant",
      content: [],
      createdAt: "2026-11-23T21:05:02Z",
      status: "sending",
    };
    expect(
      wordMessageContext(
        { "user-0": earlier, "user-1": request, "answer-1": streaming },
        ["user-0", "user-1", "answer-1"],
        "answer-1",
      ),
    ).toMatchObject({
      identity: "C:\\docs\\approval-test.docx",
      requestText: "Change ALPHA-7 to BRAVO-9.",
    });
  });

  it("names the answer's model and the files sent with the request", () => {
    const answer: Message = {
      id: "answer-1",
      role: "assistant",
      content: [],
      createdAt: "2026-11-23T20:57:10Z",
      previous_message_id: "user-1",
      chatProviderId: "model-1",
    };
    expect(
      wordMessageContext(
        {
          "user-1": { ...request, input_files_ids: ["img-1"] },
          "answer-1": answer,
        },
        ["user-1", "answer-1"],
        "answer-1",
      ),
    ).toMatchObject({ modelId: "model-1", fileIds: ["img-1"] });
  });

  it("knows nothing about a message it does not have", () => {
    expect(wordMessageContext({ "user-1": request }, ["user-1"], "x")).toEqual(
      {},
    );
  });
});
