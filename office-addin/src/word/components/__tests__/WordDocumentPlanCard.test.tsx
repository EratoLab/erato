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
import { installWordOoxmlHost } from "../../../test/mocks/word/ooxmlHost";
import {
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
import { WordHostCardRenderer } from "../WordHostCardRenderer";

import type { WordDocumentCapture } from "../../utils/wordDocumentCapture";
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
    expect(screen.getByRole("button", { name: "Revert batch" })).toBeEnabled();
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
    fireEvent.click(screen.getByRole("button", { name: "Revert batch" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Revert batch" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Revert batch" }));
    await waitFor(() => expect(state.insert).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("discloses Word's own first-paragraph spacing change and keeps the exact original downloadable after a content-tier Revert", async () => {
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
    await screen.findByText("Document rewrite applied");
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
    fireEvent.click(screen.getByRole("button", { name: "Revert batch" }));
    await screen.findByText("Document body restored");
    expect(word.insert).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Revert batch" })).toBeNull();
    expect(screen.getByTestId("word-plan-adjustments")).toHaveTextContent(
      "Word also changed the spacing before the first paragraph.",
    );
    expect(
      screen.getByRole("button", { name: "Download original document" }),
    ).toBeInTheDocument();
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
