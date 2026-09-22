import { i18n } from "@lingui/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TestTheme } from "../../../test/helpers/TestTheme";
import { mixedAuthoringXml } from "../../../test/mocks/word/mixedAuthoringFixtures";
import { WordWriteProvider } from "../../providers/WordWriteProvider";
import { wordActionForFence } from "../../utils/wordClientActions";
import {
  encodeWordDocumentBackup,
  wordDocumentOoxmlToFile,
} from "../../utils/wordDocumentPackage";
import { wordSourceReadRefs } from "../../utils/wordDocumentPlan";
import { captureWordAuthoringSnapshot } from "../../utils/wordDocumentXml";
import { WordDocumentPlanCard } from "../WordDocumentPlanCard";

import type { WordDocumentCapture } from "../../utils/wordDocumentCapture";
import type { WordDocumentPlan } from "../../utils/wordDocumentPlan";
import type * as EratoLibrary from "@erato/frontend/library";

const host = vi.hoisted(() => ({ messageId: "download-message" }));
vi.mock("@erato/frontend/library", async (importOriginal) => ({
  ...(await importOriginal<typeof EratoLibrary>()),
  useHostArtifact: () => ({
    facetId: "word_document_authoring",
    messageId: host.messageId,
    itemIdentity: "doc-A",
    allowedClientActions: ["word.apply_document_plan"],
    clientActionPresentation: "render_buttons",
  }),
  useChatContext: () => ({
    messages: { [host.messageId]: { status: "completed", role: "assistant" } },
    messageOrder: [host.messageId],
  }),
  usePersistedState: () => [{}, vi.fn()],
  useConfirmationRegistryStore: (select: (value: unknown) => unknown) =>
    select({
      registerConfirmation: () => {},
      unregisterConfirmation: () => {},
    }),
}));

async function interruptedDocument() {
  const ooxml = mixedAuthoringXml();
  const bytes = wordDocumentOoxmlToFile(ooxml);
  const snapshot = captureWordAuthoringSnapshot(ooxml, "doc-A", "Off", true);
  snapshot.ownerMessageId = host.messageId;
  snapshot.readToken = "complete-read";
  snapshot.read = new Set(wordSourceReadRefs(snapshot));
  expect(snapshot.issue).toBeUndefined();
  const plan: WordDocumentPlan = {
    version: 1,
    snapshot: snapshot.token,
    readToken: snapshot.readToken,
    scope: "document",
    entries: [{ kind: "keep", source: snapshot.blocks.map((b) => b.ref) }],
    deleted: [],
  };
  const before = encodeWordDocumentBackup({
    bytes,
    ooxml,
    documentUrl: "file:///review-source.docx",
    fingerprint: snapshot.fingerprint,
  });
  const capture: WordDocumentCapture = {
    identity: "doc-A",
    authoring: snapshot,
    ordinalMap: new Map(),
    paragraphsSent: snapshot.blocks.length,
    renderedOrdinals: new Set(),
    partialOrdinal: null,
  };
  const entry = {
    ...wordActionForFence("erato-word-document-plan")!,
    execute: vi.fn(async () => ({
      ok: false,
      outcomes: [],
      snapshotOoxml: null,
      documentPlanResult: {
        status: "interrupted" as const,
        before,
        diagnostic: { stage: "write" as const, reason: "host-error" as const },
      },
    })),
  };
  const { container } = render(
    <WordWriteProvider
      documentIdentity="doc-A"
      capturesByAssistantMessageId={new Map([[host.messageId, capture]])}
    >
      <WordDocumentPlanCard entry={entry} content={JSON.stringify(plan)} />
    </WordWriteProvider>,
    { wrapper: TestTheme },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Apply document rewrite" }),
  );
  await screen.findByRole("button", { name: "Download original document" });
  return { bytes, entry, container };
}
function downloadUrls() {
  const create = vi.fn<(blob: Blob) => string>(() => "blob:original-document");
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  return { create, revoke };
}
beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("complete original Word document download", () => {
  it("downloads exact original DOCX bytes with the DOCX MIME/filename through the shared controls", async () => {
    const { bytes, entry, container } = await interruptedDocument();
    const { create, revoke } = downloadUrls();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("word-document-before-rewrite.docx");
        expect(this.href).toBe("blob:original-document");
        expect(this.isConnected).toBe(true);
      });
    const download = screen.getByRole("button", {
      name: "Download original document",
    });
    expect(download).toHaveAttribute("data-variant", "secondary");
    expect(download).toHaveAttribute("data-geometry");
    expect(container.querySelector('[data-ui="card"]')).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Download original body" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Restore original document" }),
    ).toBeNull();
    vi.useFakeTimers();
    fireEvent.click(download);
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    expect(document.querySelector("a[download]")).toBeNull();
    vi.runOnlyPendingTimers();
    expect(revoke).toHaveBeenCalledWith("blob:original-document");
    vi.useRealTimers();
    const blob = create.mock.calls[0][0];
    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
    expect(new Uint8Array(buffer)).toEqual(bytes);
    expect(entry.execute).toHaveBeenCalledOnce();
    expect(download).toBeInTheDocument();
  });

  it("retains recovery after a failed download and clears the error after a successful retry", async () => {
    await interruptedDocument();
    const { create } = downloadUrls();
    create.mockImplementationOnce(() => {
      throw new Error("Object URLs unavailable");
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const download = screen.getByRole("button", {
      name: "Download original document",
    });
    fireEvent.click(download);
    expect(screen.getByRole("status")).toHaveTextContent(
      "The saved original could not be downloaded. It remains available in this pane.",
    );
    expect(download).toBeEnabled();
    fireEvent.click(download);
    await waitFor(() =>
      expect(
        screen.queryByText(/saved original could not be downloaded/),
      ).toBeNull(),
    );
    expect(click).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledTimes(2);
  });
});
