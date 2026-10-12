import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { subscribeWordDocumentChanged } from "../../utils/wordDocumentChangeSignal";
import { useWordWrite, WordWriteProvider } from "../WordWriteProvider";

import type { WordWriteContextValue } from "../WordWriteProvider";

vi.mock("../../../hooks/officeSelectionChangedBroker", () => ({
  subscribeToOfficeSelectionChanged: () => () => {},
}));

let host: WordWriteContextValue;

function Probe() {
  host = useWordWrite();
  return null;
}

describe("WordWriteProvider document changes", () => {
  it("reports every ended operation as a document change, so the next send captures again", () => {
    const changed = vi.fn();
    const unsubscribe = subscribeWordDocumentChanged(changed);
    render(
      <WordWriteProvider
        documentIdentity="doc"
        capturesByAssistantMessageId={new Map()}
      >
        <Probe />
      </WordWriteProvider>,
    );

    act(() => {
      host.beginOperation();
    });
    expect(changed).not.toHaveBeenCalled();
    act(() => host.endOperation());

    expect(changed).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
