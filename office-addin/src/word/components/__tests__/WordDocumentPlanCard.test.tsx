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
import {
  examplePlan,
  readySnapshot,
  wordSerializationNoise,
} from "../../../test/mocks/word/authoringFixtures";
import {
  editWordPackage,
  installWordOoxmlHost,
} from "../../../test/mocks/word/ooxmlHost";
import {
  SENTINEL,
  captureRealisticSnapshot,
  realisticWordPackageXml,
  statusRewritePlan,
} from "../../../test/mocks/word/realisticWordFixtures";
import { WordWriteProvider } from "../../providers/WordWriteProvider";
import { buildWordArtifact } from "../../utils/buildWordArtifact";
import { WordDocumentReadSession } from "../../utils/wordDocumentReadTool";
import {
  createWordDocumentSubmissionExecutor,
  WORD_SUBMIT_PLAN_TOOL,
} from "../../utils/wordDocumentSubmission";
import { wordDocumentFingerprint } from "../../utils/wordDocumentXml";
import {
  ALL_WORD_IN_PLACE_CAPABILITIES,
  setWordInPlaceCapabilitiesForTests,
} from "../../utils/wordInPlaceCapabilities";
import {
  WORD_COMPATIBILITY_MODE_KEY,
  resetWordInPlaceLatchForTests,
} from "../../utils/wordInPlaceSwitch";
import { WordHostCardRenderer } from "../WordHostCardRenderer";

import type { WordOoxmlHostOptions } from "../../../test/mocks/word/ooxmlHost";
import type { WordDocumentCapture } from "../../utils/wordDocumentCapture";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanEntry,
} from "../../utils/wordDocumentPlan";
import type * as EratoLibrary from "@erato/frontend/library";

const mock = vi.hoisted(() => {
  const artifact: Record<string, unknown> = {};
  return { artifact, decisions: {}, setDecisions: vi.fn() };
});
vi.mock("@erato/frontend/library", async (importOriginal) => ({
  ...(await importOriginal<typeof EratoLibrary>()),
  CopyErrorButton: () => null,
  useHostArtifact: () => mock.artifact,
  useChatContext: () => ({
    messages: {
      [String(mock.artifact.messageId)]: {
        status: "completed",
        role: "assistant",
      },
    },
    messageOrder: [String(mock.artifact.messageId)],
  }),
  usePersistedState: () => [mock.decisions, mock.setDecisions],
  useConfirmationRegistryStore: (select: (value: unknown) => unknown) =>
    select({
      registerConfirmation: () => {},
      unregisterConfirmation: () => {},
    }),
  ActionConfirmationCard: ({
    onAllowOnce,
    onDeny,
    onAlwaysAllow,
    isBusy,
    progressLabel,
  }: {
    onAllowOnce: () => void;
    onDeny: () => void;
    onAlwaysAllow: () => void;
    isBusy: boolean;
    progressLabel?: string;
  }) => (
    <div>
      {progressLabel && <output>{progressLabel}</output>}
      <button disabled={isBusy} onClick={onAllowOnce}>
        Allow once
      </button>
      <button disabled={isBusy} onClick={onAlwaysAllow}>
        Always allow
      </button>
      <button onClick={onDeny}>Deny</button>
    </div>
  ),
}));
function setup() {
  const snapshot = readySnapshot();
  const messageId = String(mock.artifact.messageId);
  snapshot.ownerMessageId = messageId;
  const plan = examplePlan(snapshot.token);
  const capture: WordDocumentCapture = {
    identity: "doc-A",
    authoring: snapshot,
    ordinalMap: new Map(
      snapshot.blocks.map((b, i) => [
        i + 1,
        { uniqueLocalId: b.ref, text: b.text },
      ]),
    ),
    paragraphsSent: 6,
    renderedOrdinals: new Set([1, 2, 3, 4, 5, 6]),
    partialOrdinal: null,
  };
  let current = snapshot.ooxml;
  let fail = false;
  let unreadable = false;
  let noise = false;
  const insert = vi.fn((value: string) => {
    current = noise ? wordSerializationNoise(value) : value;
    if (fail) throw new Error("Uncertain write");
  });
  const context = {
    document: {
      changeTrackingMode: "Off",
      load: vi.fn(),
      body: {
        getOoxml: () => {
          if (unreadable && insert.mock.calls.length)
            throw new Error("Read failed");
          return { value: current };
        },
        insertOoxml: insert,
      },
    },
    sync: async () => {},
  };
  vi.stubGlobal("Word", {
    run: async (callback: (context: Word.RequestContext) => Promise<unknown>) =>
      callback(context as unknown as Word.RequestContext),
  });
  const mount = () =>
    render(
      <WordWriteProvider
        documentIdentity="doc-A"
        capturesByAssistantMessageId={new Map([[messageId, capture]])}
      >
        <WordHostCardRenderer
          language="erato-word-document-plan"
          content={JSON.stringify(plan)}
        />
      </WordWriteProvider>,
      { wrapper: TestTheme },
    );
  return {
    snapshot,
    plan,
    capture,
    insert,
    mount,
    fail: () => {
      fail = true;
    },
    failRead: () => {
      unreadable = true;
    },
    resume: () => {
      fail = false;
      unreadable = false;
    },
    noise: () => {
      noise = true;
      current = wordSerializationNoise(current);
    },
    change: () => {
      current = current.replace("Recommendation", "Later edit");
    },
    fingerprint: () => wordDocumentFingerprint(current),
  };
}
/** Hold every Word batch until released, to observe the in-progress UI. */
function holdWord() {
  const word = (
    globalThis as unknown as {
      Word: { run: (callback: never) => Promise<unknown> };
    }
  ).Word;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal("Word", {
    run: async (callback: never) => {
      await held;
      return word.run(callback);
    },
  });
  return release;
}
function renderRealisticCard(
  snapshot: ReturnType<typeof readySnapshot>,
  content: string,
) {
  const messageId = String(mock.artifact.messageId);
  const capture: WordDocumentCapture = {
    identity: "doc-A",
    authoring: snapshot,
    ordinalMap: new Map(),
    paragraphsSent: snapshot.blocks.length,
    renderedOrdinals: new Set(),
    partialOrdinal: null,
  };
  return render(
    <WordWriteProvider
      documentIdentity="doc-A"
      capturesByAssistantMessageId={new Map([[messageId, capture]])}
    >
      <WordHostCardRenderer
        language="erato-word-document-plan"
        content={content}
      />
    </WordWriteProvider>,
    { wrapper: TestTheme },
  );
}
beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
  mock.decisions = {};
  mock.setDecisions.mockClear();
  mock.artifact = {
    facetId: "word_document_authoring",
    messageId: globalThis.crypto.randomUUID(),
    itemIdentity: "doc-A",
    allowedClientActions: ["word.apply_document_plan"],
    isFreshCompletion: true,
    clientActionPresentation: "render_buttons",
  };
});
afterEach(() => {
  cleanup();
  localStorage.removeItem(WORD_COMPATIBILITY_MODE_KEY);
  delete window.WORD_FORCE_IMPORT_APPLY;
  resetWordInPlaceLatchForTests();
  setWordInPlaceCapabilitiesForTests(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("structural document review", () => {
  it("requires consent for an accepted submission, then applies once with recovery", async () => {
    const state = setup();
    const session = new WordDocumentReadSession();
    const context = {
      toolCallId: "submission",
      messageId: String(mock.artifact.messageId),
      chatId: "chat-A",
    };
    session.activate(state.snapshot, context);
    await session.execute(
      { snapshot: state.snapshot.token },
      { ...context, toolCallId: "read" },
    );
    state.plan.readToken = state.snapshot.readToken!;
    const result = await createWordDocumentSubmissionExecutor(session)(
      state.plan,
      context,
    );
    expect(state.insert).not.toHaveBeenCalled();
    if (!result.ok) throw new Error("Expected accepted plan");
    mock.artifact = {
      ...buildWordArtifact({
        facetId: "word_document_authoring",
        clientActionInfo: {
          clientActions: ["word.apply_document_plan"],
          alwaysAskActions: ["word.apply_document_plan"],
          presentation: "auto_prompt",
        },
        content: [
          {
            content_type: "tool_use",
            tool_name: WORD_SUBMIT_PLAN_TOOL,
            tool_call_id: context.toolCallId,
            status: "success",
            input: state.plan,
            output: {
              status: "success",
              result: result.result,
              submission: { status: "accepted" },
            },
          } as unknown as EratoLibrary.ContentPart,
        ],
        messageId: context.messageId,
        capture: state.capture,
      }),
    };
    state.mount();
    const allow = await screen.findByRole("button", { name: "Allow once" });
    expect(state.insert).not.toHaveBeenCalled();
    fireEvent.click(allow);
    await screen.findByText("Document rewrite applied");
    expect(state.insert).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Restore original body" }),
    ).toBeEnabled();
  });

  it("restores a saved submission for inspection after a pane reload without enabling Apply", async () => {
    const state = setup();
    mock.artifact.submittedCard = {
      toolCallId: "saved",
      language: "erato-word-document-plan",
      content: JSON.stringify(state.plan),
    };
    mock.artifact.isFreshCompletion = false;
    delete mock.artifact.itemIdentity;
    render(
      <WordWriteProvider
        documentIdentity="doc-A"
        capturesByAssistantMessageId={new Map()}
      >
        <WordHostCardRenderer
          language="erato-word-document-plan"
          content={JSON.stringify(state.plan)}
        />
      </WordWriteProvider>,
      { wrapper: TestTheme },
    );
    expect(screen.getByText("Saved document rewrite")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Apply document rewrite" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("Recommendation")).toBeVisible();
    expect(state.insert).not.toHaveBeenCalled();
  });

  it("applies one coherent plan then collapses, reopens and guards later edits", async () => {
    const state = setup();
    state.mount();
    expect(screen.getByText("6 of 6 source blocks read")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Full draft" }));
    expect(screen.getByTestId("word-plan-group-0")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Apply document rewrite" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Document rewrite applied")).toBeInTheDocument(),
    );
    expect(state.insert).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByRole("tab", { name: "Full draft" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    state.change();
    fireEvent.click(
      screen.getByRole("button", { name: "Restore original body" }),
    );
    await waitFor(() =>
      expect(screen.getByText(/Revert was not run/)).toBeInTheDocument(),
    );
    expect(state.insert).toHaveBeenCalledTimes(1);
  });
  it("keeps the Apply button focused and busy with the current stage, then releases it", async () => {
    const state = setup();
    state.mount();
    const release = holdWord();
    const apply = screen.getByRole("button", {
      name: "Apply document rewrite",
    });
    apply.focus();
    fireEvent.click(apply);
    const busy = await screen.findByRole("button", { name: "Saving backup…" });
    expect(busy).toBe(apply);
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).toHaveFocus();
    expect(
      screen.queryByText(/Applying and verifying/),
    ).not.toBeInTheDocument();
    fireEvent.click(busy);
    release();
    await screen.findByText("Document rewrite applied");
    expect(state.insert).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });
  it("releases the busy Apply button after a failed write", async () => {
    const state = setup();
    state.fail();
    state.mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Apply document rewrite" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("partially changed"),
    );
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });
  it("shows the current stage on the consent card while applying", async () => {
    mock.artifact.clientActionPresentation = "auto_prompt";
    mock.artifact.proposedClientAction = "word.apply_document_plan";
    const state = setup();
    state.mount();
    const release = holdWord();
    fireEvent.click(await screen.findByRole("button", { name: "Allow once" }));
    expect(await screen.findByText("Saving backup…")).toBeInTheDocument();
    release();
    await screen.findByText("Document rewrite applied");
    expect(state.insert).toHaveBeenCalledTimes(1);
  });
  it("blocks a forged complete-read token and never writes", () => {
    const state = setup();
    state.plan.readToken = "forged";
    state.mount();
    expect(
      screen.getByRole("button", { name: "Apply document rewrite" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/complete document has not been read/),
    ).toBeInTheDocument();
    expect(state.insert).not.toHaveBeenCalled();
  });
  it("keeps uncertain writes expanded with a retained backup and guarded restoration", async () => {
    const state = setup();
    state.fail();
    state.mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Apply document rewrite" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("partially changed"),
    );
    expect(screen.queryByText("Document rewrite applied")).toBeNull();
    expect(screen.queryByRole("button", { name: "Revert batch" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Download original body" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Restore original body" }),
    ).toBeInTheDocument();
    expect(state.insert).toHaveBeenCalledTimes(1);
    state.resume();
    fireEvent.click(
      screen.getByRole("button", { name: "Restore original body" }),
    );
    await waitFor(() => expect(state.insert).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Download original body" }),
      ).toBeNull(),
    );
  });
  it("retains a downloadable original when an interrupted write cannot be read back", async () => {
    const state = setup();
    state.fail();
    state.failRead();
    state.mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Apply document rewrite" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("partially changed"),
    );
    expect(
      screen.queryByRole("button", { name: "Restore original body" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Download original body" }),
    ).toBeInTheDocument();
    expect(state.insert).toHaveBeenCalledTimes(1);
  });
  it("downloads the exact pre-write body after an interrupted restoration", async () => {
    const state = setup();
    state.mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Apply document rewrite" }),
    );
    await screen.findByText("Document rewrite applied");
    state.fail();
    fireEvent.click(
      screen.getByRole("button", { name: "Restore original body" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("partially changed"),
    );
    const createObjectURL = vi.fn<(blob: Blob) => string>(
      () => "blob:original-body",
    );
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = vi.fn();
      },
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("word-body-before-rewrite.xml");
        expect(this.href).toBe("blob:original-body");
      });
    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole("button", { name: "Download original body" }),
    );
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    expect(click).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0][0];
    const text = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(blob);
    });
    expect(text).toBe(state.snapshot.ooxml);
    state.resume();
    fireEvent.click(
      screen.getByRole("button", { name: "Restore original body" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Download original body" }),
      ).toBeNull(),
    );
    expect(state.insert).toHaveBeenCalledTimes(3);
  });
  it("does not report failure after harmless Word serialization changes", async () => {
    const state = setup();
    state.noise();
    state.mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Apply document rewrite" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Document rewrite applied")).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Restore original body" }),
    );
    await waitFor(() => expect(state.insert).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("discloses Word's own first-paragraph spacing change and keeps the exact original downloadable after a content-tier Revert", async () => {
    window.WORD_FORCE_IMPORT_APPLY = true;
    const word = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
      spacingDrift: true,
    });
    const messageId = String(mock.artifact.messageId);
    const snapshot = await captureRealisticSnapshot(messageId);
    const capture: WordDocumentCapture = {
      identity: "doc-A",
      authoring: snapshot,
      ordinalMap: new Map(),
      paragraphsSent: snapshot.blocks.length,
      renderedOrdinals: new Set(),
      partialOrdinal: null,
    };
    render(
      <WordWriteProvider
        documentIdentity="doc-A"
        capturesByAssistantMessageId={new Map([[messageId, capture]])}
      >
        <WordHostCardRenderer
          language="erato-word-document-plan"
          content={JSON.stringify(
            statusRewritePlan(snapshot, "Status: revised."),
          )}
        />
      </WordWriteProvider>,
      { wrapper: TestTheme },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply document rewrite" }),
    );
    await screen.findByText("Applied with Word adjustments");
    const note = screen.getByTestId("word-plan-adjustments");
    expect(note).toBeVisible();
    expect(note).toHaveTextContent(
      "Word also changed the spacing before the first paragraph.",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(word.insert).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Download original document" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Restore original document" }),
    );
    await screen.findByText("Document body restored");
    expect(word.insert).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Restore original document" }),
    ).toBeNull();
    expect(screen.getByTestId("word-plan-adjustments")).toHaveTextContent(
      "Word also changed the spacing before the first paragraph.",
    );
    expect(
      screen.getByRole("button", { name: "Download original document" }),
    ).toBeInTheDocument();
  });
  it("applies an eligible rewrite in place, then undoes exactly that paragraph", async () => {
    const word = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
    });
    const original = wordDocumentFingerprint(word.ooxml());
    const messageId = String(mock.artifact.messageId);
    const snapshot = await captureRealisticSnapshot(messageId);
    renderRealisticCard(
      snapshot,
      JSON.stringify(statusRewritePlan(snapshot, "Status: revised in place.")),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply document rewrite" }),
    );
    await screen.findByText("Document rewrite applied");
    expect(word.insert).not.toHaveBeenCalled();
    expect(word.ooxml()).toContain("Status: revised in place.");
    expect(screen.queryByTestId("word-plan-adjustments")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo these changes" }));
    await screen.findByText("Document body restored");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(wordDocumentFingerprint(word.ooxml())).toBe(original);
    expect(word.insert).not.toHaveBeenCalled();
  });
  it("says the rewrite went in as tracked changes, then rejects them on Revert", async () => {
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
    const word = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
      trackChanges: true,
    });
    word.setTrackingMode("TrackAll");
    const original = wordDocumentFingerprint(word.ooxml());
    const messageId = String(mock.artifact.messageId);
    const snapshot = await captureRealisticSnapshot(messageId, "TrackAll");
    renderRealisticCard(
      snapshot,
      JSON.stringify(
        statusRewritePlan(snapshot, "Status: revised as tracked."),
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply document rewrite" }),
    );
    await screen.findByText("Document rewrite applied");
    expect(screen.getByTestId("word-plan-adjustments")).toHaveTextContent(
      "Applied as tracked changes under your name.",
    );
    expect(word.ooxml()).toContain("<w:ins ");
    fireEvent.click(
      screen.getByRole("button", { name: "Reject these tracked changes" }),
    );
    await screen.findByText("Document body restored");
    expect(screen.queryByTestId("word-plan-adjustments")).toBeNull();
    expect(wordDocumentFingerprint(word.ooxml())).toBe(original);
    expect(word.insert).not.toHaveBeenCalled();
  });
  it("explains that a full rewrite cannot run while Track Changes is on", async () => {
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const word = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
      trackChanges: true,
    });
    word.setTrackingMode("TrackAll");
    const messageId = String(mock.artifact.messageId);
    const snapshot = await captureRealisticSnapshot(messageId, "TrackAll");
    renderRealisticCard(
      snapshot,
      JSON.stringify({
        ...statusRewritePlan(snapshot, "Status: revised."),
        sections: [{ id: "final", source: "section-1" }],
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply document rewrite" }),
    );
    expect(
      await screen.findByText(
        "This change needs a full-document rewrite, which can't run while Track Changes is on. Turn off Track Changes or ask for a smaller edit.",
      ),
    ).toBeInTheDocument();
    expect(word.insert).not.toHaveBeenCalled();
    expect(word.events.some((e) => e.startsWith("mutation:"))).toBe(false);
  });
  it("keeps the original downloadable when an in-place Revert would overwrite a later edit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const word = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
    });
    const messageId = String(mock.artifact.messageId);
    const snapshot = await captureRealisticSnapshot(messageId);
    renderRealisticCard(
      snapshot,
      JSON.stringify(statusRewritePlan(snapshot, "Status: revised in place.")),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply document rewrite" }),
    );
    await screen.findByText("Document rewrite applied");
    word.editParagraph(1, "Status: the user's own words.");
    fireEvent.click(screen.getByRole("button", { name: "Undo these changes" }));
    await screen.findByText(/Revert was not run/);
    expect(word.ooxml()).toContain("Status: the user's own words.");
    expect(
      screen.getByRole("button", { name: "Download original document" }),
    ).toBeInTheDocument();
  });
  it("offers the saved original and an in-place restore after Word stopped partway", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const word = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
    });
    const original = wordDocumentFingerprint(word.ooxml());
    const messageId = String(mock.artifact.messageId);
    const snapshot = await captureRealisticSnapshot(messageId);
    const plan = statusRewritePlan(snapshot, "Status: two changes.");
    const closing = snapshot.blocks.findIndex(
      (b) => b.text === "Closing paragraph.",
    );
    plan.entries = snapshot.blocks.map((b, i) =>
      i === 1 || i === closing
        ? {
            kind: "replace",
            source: [b.ref],
            blocks: [
              {
                id: `n${i}`,
                type: "paragraph",
                text: i === 1 ? "Status: two changes." : "Goodbye.",
              },
            ],
          }
        : { kind: "keep", source: [b.ref] },
    );
    renderRealisticCard(snapshot, JSON.stringify(plan));
    word.failAtCommand(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Apply document rewrite" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Word stopped after 1 of 2 changes. Your original is saved.",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Download original document" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo these changes" }));
    await screen.findByText("Document body restored");
    expect(wordDocumentFingerprint(word.ooxml())).toBe(original);
    expect(word.insert).not.toHaveBeenCalled();
  });
  it("respects the structural action permission independently of paragraph edits", () => {
    mock.decisions = {
      "word_document_authoring/word.apply_document_plan": "never",
      "word_document_authoring/word.apply_edits": "always",
    };
    const state = setup();
    state.mount();
    expect(
      screen.queryByRole("button", { name: "Apply document rewrite" }),
    ).toBeNull();
    expect(state.insert).not.toHaveBeenCalled();
  });
  it("asks separately for a rewrite even when paragraph edits are always allowed", async () => {
    mock.artifact.clientActionPresentation = "auto_prompt";
    mock.artifact.proposedClientAction = "word.apply_document_plan";
    mock.decisions = { "word_document_authoring/word.apply_edits": "always" };
    const state = setup();
    state.mount();
    await screen.findByRole("button", { name: "Allow once" });
    expect(state.insert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(
      screen.getByText("Proposal declined. Nothing was written."),
    ).toBeInTheDocument();
    expect(state.insert).not.toHaveBeenCalled();
  });
});

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const CLOSING = "Closing paragraph.";

/** The realistic document with an en-GB run in the closing paragraph, which a faulty
 * insertText "Replace" loses. */
function closingLanguageFixture(): string {
  return editWordPackage(realisticWordPackageXml(), (doc) => {
    const run = Array.from(doc.getElementsByTagNameNS(W, "t")).find(
      (t) => t.textContent === CLOSING,
    )!.parentElement!;
    const props = doc.createElementNS(W, "w:rPr");
    const lang = doc.createElementNS(W, "w:lang");
    lang.setAttributeNS(W, "w:val", "en-GB");
    props.append(lang);
    run.prepend(props);
  });
}

/** Keep everything and swap in `entry` for the block whose text starts with `prefix`. */
function replaceBlock(
  snapshot: WordAuthoringSnapshot,
  prefix: string,
  entry: (ref: string) => WordPlanEntry[],
  extra: Partial<WordDocumentPlan> = {},
): WordDocumentPlan {
  return {
    version: 1,
    snapshot: snapshot.token,
    readToken: "read-proof",
    scope: "document",
    deleted: [],
    entries: snapshot.blocks.flatMap((b) =>
      b.text.startsWith(prefix)
        ? entry(b.ref)
        : [{ kind: "keep", source: [b.ref] }],
    ),
    ...extra,
  };
}

async function mountRealistic(
  makePlan: (snapshot: WordAuthoringSnapshot) => WordDocumentPlan,
  options: WordOoxmlHostOptions & { tracking?: string; xml?: string } = {},
) {
  const {
    tracking = "Off",
    xml = realisticWordPackageXml(),
    ...host
  } = options;
  const word = installWordOoxmlHost(xml, {
    profile: "word-pc-16.0.20326",
    ...host,
  });
  if (tracking !== "Off") word.setTrackingMode(tracking);
  const snapshot = await captureRealisticSnapshot(
    String(mock.artifact.messageId),
    tracking,
  );
  renderRealisticCard(snapshot, JSON.stringify(makePlan(snapshot)));
  return { word, snapshot };
}

const routeText = () => screen.getByTestId("word-plan-route").textContent;
const apply = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "Apply document rewrite" }),
  );

describe("route preview", () => {
  it("says an eligible rewrite edits its passages in place", async () => {
    await mountRealistic((s) => statusRewritePlan(s, "Status: revised."));
    expect(routeText()).toBe("Edits 1 passage in place.");
  });

  it("says the passages go in as tracked changes under the user's name", async () => {
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
    await mountRealistic((s) => statusRewritePlan(s, "Status: revised."), {
      trackChanges: true,
      tracking: "TrackAll",
    });
    expect(routeText()).toBe(
      "Edits 1 passage in place as tracked changes under your name.",
    );
  });

  it("warns before Apply that Track Changes blocks a full rewrite", async () => {
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
    const { word } = await mountRealistic(
      (s) => ({
        ...statusRewritePlan(s, "Status: revised."),
        sections: [{ id: "final", source: "section-1" }],
      }),
      { trackChanges: true, tracking: "TrackAll" },
    );
    expect(routeText()).toBe(
      "This change needs a full-document rewrite, which can't run while Track Changes is on. Turn off Track Changes or ask for a smaller edit.",
    );
    expect(word.insert).not.toHaveBeenCalled();
  });

  it.each<
    [string, (snapshot: WordAuthoringSnapshot) => WordDocumentPlan, string]
  >([
    [
      "sections",
      (s) => ({
        ...statusRewritePlan(s, "Status: revised."),
        sections: [{ id: "final", source: "section-1" }],
      }),
      "Replaces the whole document because it changes sections or page layout.",
    ],
    [
      "stories",
      (s) => ({
        ...statusRewritePlan(s, "Status: revised."),
        stories: [
          {
            kind: "upsert",
            type: "header",
            id: "header1",
            blocks: [{ id: "h0", type: "paragraph", text: "Revised header" }],
          },
        ],
      }),
      "Replaces the whole document because it changes headers, footers, notes or comments.",
    ],
    [
      "moves",
      (s) => {
        const refs = s.blocks.map((b) => b.ref);
        return {
          ...statusRewritePlan(s, "Status: revised."),
          entries: [
            { kind: "keep", source: [refs[0]] },
            { kind: "keep", source: [refs[2]] },
            { kind: "keep", source: [refs[1]] },
            { kind: "keep", source: refs.slice(3) },
          ],
        };
      },
      "Replaces the whole document because it moves content.",
    ],
    [
      "objects",
      (s) =>
        replaceBlock(s, "Region", (ref) => [
          {
            kind: "replace",
            source: [ref],
            blocks: [{ id: "t", type: "paragraph", text: "No table." }],
          },
        ]),
      "Replaces the whole document because it changes tables, images or other objects.",
    ],
    [
      "formatting",
      (s) =>
        replaceBlock(s, "Status", (ref) => [
          {
            kind: "replace",
            source: [ref],
            blocks: [
              {
                id: "c",
                type: "paragraph",
                text: "Status: centred.",
                format: { alignment: "center" },
              },
            ],
          },
        ]),
      "Replaces the whole document because it changes formatting or styles.",
    ],
    [
      "lists",
      (s) =>
        replaceBlock(s, "Open questions", (ref) => [
          {
            kind: "replace",
            source: [ref],
            blocks: [
              {
                id: "l",
                type: "list-item",
                text: "Open questions follow.",
                list: "fresh",
                level: 0,
                ordered: true,
              },
            ],
          },
        ]),
      "Replaces the whole document because it changes lists.",
    ],
    [
      "paragraphs",
      (s) =>
        replaceBlock(s, "Status", (ref) => [
          { kind: "keep", source: [ref] },
          {
            kind: "insert",
            blocks: [{ id: "a", type: "paragraph", text: "An added line." }],
          },
        ]),
      "Replaces the whole document because it adds, removes or splits paragraphs.",
    ],
  ])(
    "names why a %s change replaces the whole document",
    async (_, makePlan, text) => {
      await mountRealistic(makePlan);
      expect(routeText()).toBe(text);
    },
  );

  it("says compatibility mode makes every rewrite a full replacement, and Apply follows it", async () => {
    localStorage.setItem(WORD_COMPATIBILITY_MODE_KEY, "1");
    const { word } = await mountRealistic(
      (s) => statusRewritePlan(s, "Status: revised."),
      { profile: "word-web" },
    );
    expect(routeText()).toBe(
      "Replaces the whole document because compatibility mode is on.",
    );
    apply();
    await screen.findByText("Document rewrite applied");
    expect(word.insert).toHaveBeenCalledTimes(1);
  });

  it("does not blame the change when in-place writing is switched off", async () => {
    window.WORD_FORCE_IMPORT_APPLY = true;
    await mountRealistic((s) => statusRewritePlan(s, "Status: revised."));
    expect(routeText()).toBe(
      "Replaces the whole document (in-place editing is off).",
    );
  });

  it("keeps the general reason for a change the classifier cannot write in place", async () => {
    await mountRealistic((s) =>
      replaceBlock(s, "Status", (ref) => [
        {
          kind: "replace",
          source: [ref],
          blocks: [{ id: "e", type: "paragraph", text: "" }],
        },
      ]),
    );
    expect(routeText()).toBe(
      "Replaces the whole document because this change can't be written in place.",
    );
  });
});

describe("apply outcomes", () => {
  it("verified in place: headline, Undo and Show changes in Word", async () => {
    const { word } = await mountRealistic((s) =>
      statusRewritePlan(s, "Status: revised in place."),
    );
    apply();
    const receipt = await screen.findByTestId("word-review-receipt");
    expect(receipt).toHaveTextContent("Document rewrite applied");
    expect(receipt).toHaveTextContent(
      "Verified: the document matches the proposal.",
    );
    expect(
      screen.getByRole("button", { name: "Undo these changes" }),
    ).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Copy details" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Download original document" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Show changes in Word" }),
    );
    await waitFor(() =>
      expect(
        word.events.filter((e) => e.startsWith("select:paragraphs:")),
      ).toHaveLength(1),
    );
    expect(screen.queryByText(/cannot be located/)).toBeNull();
  });

  it("verified as tracked changes: Show changes selects the first revision", async () => {
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
    const { word } = await mountRealistic(
      (s) => statusRewritePlan(s, "Status: revised as tracked."),
      { trackChanges: true, tracking: "TrackAll" },
    );
    apply();
    await screen.findByText("Document rewrite applied");
    expect(
      screen.getByRole("button", { name: "Reject these tracked changes" }),
    ).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Show changes in Word" }),
    );
    await waitFor(() =>
      expect(
        word.events.filter((e) => e.startsWith("select:tracked-change:")),
      ).toHaveLength(1),
    );
    expect(word.events.some((e) => e.startsWith("select:paragraphs:"))).toBe(
      false,
    );
  });

  it("says when the written passage can no longer be found", async () => {
    const { word } = await mountRealistic((s) =>
      statusRewritePlan(s, "Status: revised in place."),
    );
    apply();
    await screen.findByText("Document rewrite applied");
    word.userEdit((ooxml) =>
      editWordPackage(ooxml, (doc) =>
        Array.from(doc.getElementsByTagNameNS(W, "p"))
          .find((p) => p.textContent?.startsWith("Status"))!
          .remove(),
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Show changes in Word" }),
    );
    expect(
      await screen.findByText(
        "This source passage has changed or cannot be located reliably.",
      ),
    ).toBeInTheDocument();
    expect(word.events.some((e) => e.startsWith("select:"))).toBe(false);
  });

  it("applied with Word adjustments: headline, disclosure and a content-free Copy details", async () => {
    window.WORD_FORCE_IMPORT_APPLY = true;
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await mountRealistic((s) => statusRewritePlan(s, "Status: revised."), {
      spacingDrift: true,
    });
    apply();
    const receipt = await screen.findByTestId("word-review-receipt");
    expect(receipt).toHaveTextContent("Applied with Word adjustments");
    expect(receipt).not.toHaveTextContent("Verified");
    expect(screen.getByTestId("word-plan-adjustments")).toHaveTextContent(
      "Word adjusted some details on its own while writing; the content matches the proposal. Word also changed the spacing before the first paragraph.",
    );
    expect(
      screen.getByRole("button", { name: "Restore original document" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Show changes in Word" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
    await screen.findByText("Details copied.");
    const report = writeText.mock.calls[0][0];
    expect(report.split("\n")[0]).toBe(
      "Word add-in apply succeeded with adjustments",
    );
    expect(report).toContain("Route: import");
    expect(report).toContain("Verify tier: content");
    expect(report).toMatch(/Adjustments: .*first-paragraph-spacing/);
    expect(report).not.toContain(SENTINEL);
    expect(report).not.toContain("Status:");
  });

  it("unverified: counts the passages that do not match and locates each", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { word } = await mountRealistic(
      (s) =>
        replaceBlock(s, CLOSING, (ref) => [
          {
            kind: "replace",
            source: [ref],
            blocks: [
              {
                id: "bye",
                type: "paragraph",
                text: "Bye.",
                runs: [{ text: "Bye.", language: "en-GB" }],
              },
            ],
          },
        ]),
      { xml: closingLanguageFixture(), replaceDropsRunProperties: true },
    );
    apply();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Word wrote the changes, but 1 passage doesn't match the proposal. Your original is saved for recovery.",
    );
    expect(
      screen.getByRole("button", { name: "Restore original document" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Download original document" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show changes in Word" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Locate passage 1" }));
    await waitFor(() =>
      expect(
        word.events.filter((e) => e.startsWith("select:paragraphs:")),
      ).toHaveLength(1),
    );
  });

  it("partly written: counts changes, not regions, when Word stops inside one region", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rewrites: Record<string, string> = {
      "Confirm the regions.": "Confirm every region.",
      "Schedule the pilot.": "Schedule the pilot for October.",
    };
    const { word } = await mountRealistic((s) => ({
      version: 1,
      snapshot: s.token,
      readToken: "read-proof",
      scope: "document",
      deleted: [],
      entries: s.blocks.map(
        (b): WordPlanEntry =>
          rewrites[b.text]
            ? {
                kind: "replace",
                source: [b.ref],
                blocks: [
                  {
                    id: b.ref,
                    type: "list-item",
                    text: rewrites[b.text],
                    list: b.list,
                    ordered: b.ordered,
                    level: b.level,
                    styleRef: b.styleRef,
                  },
                ],
              }
            : { kind: "keep", source: [b.ref] },
      ),
    }));
    expect(routeText()).toBe("Edits 2 passages in place.");
    word.failAtCommand(2);
    apply();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Word stopped after 1 of 2 changes. Your original is saved.",
    );
  });

  it("does not claim a partial write when Word wrote every change before stopping", async () => {
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { word } = await mountRealistic((s) =>
      replaceBlock(s, "Status", (ref) => [
        { kind: "keep", source: [ref] },
        {
          kind: "insert",
          blocks: [{ id: "h", type: "heading", level: 2, text: "Next steps" }],
        },
      ]),
    );
    // insertParagraph, insertText, then the heading style Word rejects.
    word.failAtCommand(3);
    apply();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Word could not complete the operation. The document may be partially changed.",
    );
    expect(alert).not.toHaveTextContent(/Word stopped after/);
  });

  it("not written: a changed target stops before writing, with nothing to restore", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { word } = await mountRealistic((s) =>
      statusRewritePlan(s, "Status: revised in place."),
    );
    word.editParagraph(1, "Status: the user's own words.");
    apply();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The document changed. Nothing was applied.",
    );
    expect(word.events.some((e) => e.startsWith("mutation:"))).toBe(false);
    for (const name of [
      "Undo these changes",
      "Restore original document",
      "Download original document",
    ])
      expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("locates a written passage from the scoped review after an in-place Apply", async () => {
    const { word, snapshot } = await mountRealistic((s) => {
      const status = s.blocks.find((b) => b.text.startsWith("Status"))!;
      s.readScopes = new Map([
        [
          "read-proof",
          {
            kind: "objects",
            snapshot: s.token,
            identity: s.identity,
            fingerprint: s.fingerprint,
            targets: [
              {
                ref: status.ref,
                kind: "paragraph",
                text: "",
                bodyRef: status.ref,
                detail: {},
              },
            ],
            plans: new Set(),
          },
        ],
      ]);
      return statusRewritePlan(s, "Status: revised in place.");
    });
    expect(snapshot.readScopes?.size).toBe(1);
    apply();
    await screen.findByText("Document rewrite applied");
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    fireEvent.click(screen.getByRole("button", { name: "Locate passage 1" }));
    await waitFor(() =>
      expect(
        word.events.filter((e) => e.startsWith("select:paragraphs:")),
      ).toHaveLength(1),
    );
  });
});
