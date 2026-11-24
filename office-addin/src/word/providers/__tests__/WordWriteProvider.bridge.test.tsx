import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { wordWriteBridge } from "../../utils/wordWriteBridge";
import { WordWriteProvider } from "../WordWriteProvider";

import type { WordDocumentCapture } from "@erato/frontend/word-review";

vi.mock("../../../hooks/officeSelectionChangedBroker", () => ({
  subscribeToOfficeSelectionChanged: () => () => {},
}));

const capture = { identity: "doc" } as WordDocumentCapture;

describe("WordWriteProvider bridge", () => {
  it("lets a server call find the copy of an answer that is still streaming", () => {
    render(
      <WordWriteProvider
        documentIdentity="doc"
        capturesByAssistantMessageId={new Map()}
        captureFor={(messageId) => (messageId === "a1" ? capture : undefined)}
      >
        {null}
      </WordWriteProvider>,
    );

    expect(wordWriteBridge()?.captureFor("a1")).toBe(capture);
    expect(wordWriteBridge()?.captureFor("a0")).toBeUndefined();
  });

  it("falls back to the bound copies", () => {
    render(
      <WordWriteProvider
        documentIdentity="doc"
        capturesByAssistantMessageId={new Map([["a1", capture]])}
      >
        {null}
      </WordWriteProvider>,
    );

    expect(wordWriteBridge()?.captureFor("a1")).toBe(capture);
  });
});
