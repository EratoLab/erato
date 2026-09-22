import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readySnapshot,
  sixParagraphXml,
} from "../../../test/mocks/word/authoringFixtures";
import { mixedAuthoringXml } from "../../../test/mocks/word/mixedAuthoringFixtures";
import { createWordReadRequestStore } from "../../../test/mocks/word/readRequestStore";
import { wordDocumentReadSession } from "../../utils/wordDocumentReadTool";
import { WordChatInput } from "../WordChatInput";

import type { AddinChatInputRenderProps } from "../../../core/AddinChatCore";
import type { WordDocumentCapture } from "../../utils/wordDocumentCapture";
import type { ClientToolExecutor } from "@erato/frontend/library";

const mocks = vi.hoisted(() => ({
  estimate: vi.fn(),
  read: vi.fn(),
  tool: null as ClientToolExecutor | null,
  toolName: "",
  advertiseParkedOoxml: false,
  streamStore: undefined as
    | ReturnType<typeof createWordReadRequestStore>
    | undefined,
}));
vi.mock("@erato/frontend/library", async () => {
  const { createEratoLibraryMock } = await import(
    "../../../test/helpers/eratoLibraryMock"
  );
  return createEratoLibraryMock({
    Alert: ({ children }: { children: React.ReactNode }) => (
      <div role="alert">{children}</div>
    ),
    useFacets: () => ({
      data: {
        action_facets: [
          { id: "word_document_authoring" },
          { id: "word_document_review" },
          ...(mocks.advertiseParkedOoxml
            ? [{ id: "word_document_ooxml" }]
            : []),
        ],
      },
    }),
    fetchTokenUsageEstimate: mocks.estimate,
    useMessagingStore: {
      getState: () => mocks.streamStore!.getState(),
      subscribe: (
        listener: Parameters<
          ReturnType<typeof createWordReadRequestStore>["subscribe"]
        >[0],
      ) => mocks.streamStore!.subscribe(listener),
    },
    registerClientToolExecutor: (
      name: string,
      executor: ClientToolExecutor,
    ) => {
      mocks.tool = executor;
      mocks.toolName = name;
      return () => {
        mocks.tool = null;
      };
    },
  });
});
vi.mock("../../utils/readWordDocument", () => ({
  readWordDocument: mocks.read,
}));
vi.mock("../../../core/AddinChatInputCore", () => ({
  AddinChatInputCore: ({
    onSendMessage,
  }: {
    onSendMessage: (message: string) => void;
  }) => (
    <button onClick={() => onSendMessage("Reorganize this document")}>
      Send
    </button>
  ),
}));
beforeEach(() => {
  mocks.streamStore = createWordReadRequestStore();
  mocks.advertiseParkedOoxml = false;
  mocks.toolName = "";
  i18n.load("en", {});
  i18n.activate("en");
  mocks.estimate.mockResolvedValue({
    stats: { total_tokens: 5000, max_tokens: 128000 },
  });
  mocks.read.mockImplementation(async (authoring: boolean) => ({
    ok: true,
    paragraphs: readySnapshot().blocks.map((b, i) => ({
      ordinal: i + 1,
      text: b.text,
      uniqueLocalId: b.ref,
      outlineLevel: 10,
      styleBuiltIn: "Normal",
    })),
    ...(authoring
      ? { authoring: { ooxml: sixParagraphXml(), tracking: "Off" } }
      : {}),
  }));
});
afterEach(() => {
  cleanup();
  wordDocumentReadSession.clear();
  vi.clearAllMocks();
});
function setup() {
  const send = vi.fn();
  send.mockImplementation(() => {
    mocks.streamStore!.setState({
      streams: {
        "chat-A": {
          currentMessageId: `message-${String.fromCharCode(64 + send.mock.calls.length)}`,
          isStreaming: true,
        },
      },
    });
  });
  const stage = vi.fn();
  const props = {
    chatId: "chat-A",
    onSendMessage: send,
    controlledSelectedModel: { chat_provider_id: "model-A" },
  } as unknown as AddinChatInputRenderProps;
  render(
    <WordChatInput
      chatInputProps={props}
      documentIdentity="doc-A"
      stagePendingCapture={stage}
    />,
  );
  fireEvent.click(screen.getByTestId("word-include-document-chip"));
  return { send, stage };
}
describe("authoring send integration", () => {
  it("binds a fresh follow-up capture before reading with a token from the previous applied turn", async () => {
    const { send, stage } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    const first = (stage.mock.calls.at(-1)?.[0] as WordDocumentCapture)
      .authoring!;
    expect(first.ownerMessageId).toBe("message-A");
    expect(
      (
        await mocks.tool!(
          { snapshot: first.token },
          { toolCallId: "read-A", messageId: "message-A", chatId: "chat-A" },
        )
      ).ok,
    ).toBe(true);
    first.used = true;
    mocks.read.mockImplementation(async (authoring: boolean) => ({
      ok: true,
      paragraphs: [],
      ...(authoring
        ? {
            authoring: {
              ooxml: sixParagraphXml().replace("Context", "Updated structure"),
              tracking: "Off",
            },
          }
        : {}),
    }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    const next = (stage.mock.calls.at(-1)?.[0] as WordDocumentCapture)
      .authoring!;
    expect(next.token).not.toBe(first.token);
    expect(send.mock.calls[1][4].args.document_snapshot).toBe(next.token);
    expect(next.ownerMessageId).toBe("message-B");
    expect(
      await mocks.tool!(
        { snapshot: first.token },
        {
          toolCallId: "delayed-read",
          messageId: "message-A",
          chatId: "chat-A",
        },
      ),
    ).toMatchObject({ ok: false });
    const response = await mocks.tool!(
      { snapshot: first.token, cursor: null },
      { toolCallId: "read-B", messageId: "message-B", chatId: "chat-A" },
    );
    expect(response).toMatchObject({
      ok: true,
      result: {
        snapshot: next.token,
        snapshotRecovery: { requestedSnapshot: first.token, restarted: true },
      },
    });
    expect(JSON.stringify(response)).toContain("Updated structure");
  });

  it("keeps structured authoring when a cached facet response still advertises the parked experiment", async () => {
    mocks.advertiseParkedOoxml = true;
    const { send, stage } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0][4]).toMatchObject({
      id: "word_document_authoring",
      args: { authoring_status: "available" },
    });
    expect(mocks.read).toHaveBeenCalledWith(true);
    expect(mocks.toolName).toBe("read_document_blocks");
    const capture = stage.mock.calls.at(-1)?.[0] as WordDocumentCapture;
    expect(capture.authoring?.blocks).toHaveLength(6);
    const read = await mocks.tool?.(
      { snapshot: capture.authoring?.token },
      { toolCallId: "read", messageId: "message-A", chatId: "chat-A" },
    );
    expect(read?.ok).toBe(true);
    expect(capture.authoring?.readToken).toBeTruthy();
  });
  it("makes mixed documents available without equating native blocks with paragraph ordinals", async () => {
    const mixed = mixedAuthoringXml();
    mocks.read.mockResolvedValue({
      ok: true,
      // Word includes table-cell paragraphs here, unlike the native body block inventory.
      paragraphs: [
        "Background: the pilot starts in October.",
        "Region",
        "Budget",
        "North",
        "€42,000",
        "",
        "Example customer",
        "Bound project content",
        "Evidence start",
        "Evidence end",
        "Reviewed assumption",
        "Note-bearing statement",
        "Recommendation: retain support and review at month end.",
      ].map((text, i) => ({
        ordinal: i + 1,
        text,
        uniqueLocalId: `native-${i}`,
        styleBuiltIn: "Normal",
        outlineLevel: 10,
      })),
      authoring: { ooxml: mixed, tracking: "Off" },
    });
    const { send, stage } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0][4].args.authoring_status).toBe("available");
    const snapshot = (stage.mock.calls.at(-1)?.[0] as WordDocumentCapture)
      .authoring!;
    expect(snapshot.blocks.at(-1)?.paragraphOrdinal).toBe(13);
    const result = await mocks.tool?.(
      { snapshot: snapshot.token },
      { toolCallId: "read", messageId: "message-A", chatId: "chat-A" },
    );
    expect(result?.ok).toBe(true);
    if (!result?.ok) throw new Error("Mixed document read failed");
    const page = result.result as {
      blocks: { type: string; nativeKind?: string }[];
      nativeContent: string;
      preservedStories: string[];
    };
    expect(page.blocks.some((b) => b.nativeKind === "table")).toBe(true);
    expect(page.nativeContent).toContain(
      "source operations: keep, replace, deleted",
    );
    expect(page.preservedStories).toContain("header");
    expect(JSON.stringify(page)).not.toMatch(/<w:|binaryData|paragraphOrdinal/);
  });
  it("shows and sends the specific reason when native content is incomplete", async () => {
    mocks.read.mockResolvedValue({
      ok: true,
      paragraphs: [],
      authoring: {
        ooxml: mixedAuthoringXml().replace(
          'w:bookmarkEnd w:id="5"',
          'w:bookmarkEnd w:id="99"',
        ),
        tracking: "Off",
      },
    });
    const { send } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0][4].args.authoring_status).toBe(
      "unsupported (unbalanced-anchors)",
    );
    expect(
      screen.getByText(/bookmark or annotation extends beyond/),
    ).toBeVisible();
  });
  it("sends a structured-capable facet for non-empty documents and registers its exact read snapshot", async () => {
    const { send, stage } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    const facet = send.mock.calls[0][4];
    const capture = stage.mock.calls.at(-1)?.[0] as WordDocumentCapture;
    expect(facet).toMatchObject({
      id: "word_document_authoring",
      args: { authoring_status: "available", document_identity: "doc-A" },
    });
    expect(facet.args.document_snapshot).toBe(capture.authoring?.token);
    expect(mocks.estimate.mock.calls[0][0].body.chat_provider_id).toBe(
      "model-A",
    );
    const result = await mocks.tool?.(
      { snapshot: facet.args.document_snapshot },
      { toolCallId: "tool", messageId: "message-A", chatId: "chat-A" },
    );
    expect(result?.ok).toBe(true);
    expect(capture.authoring?.readToken).toBeTruthy();
    expect(capture.authoring?.read.size).toBe(6);
    fireEvent.click(screen.getByTestId("word-include-document-chip"));
    expect(capture.authoring?.revoked).toBe(true);
  });
  it("reports a model-context limit instead of presenting an incomplete rewrite as available", async () => {
    mocks.estimate.mockResolvedValue({
      stats: { total_tokens: 30000, max_tokens: 32000 },
    });
    const { send, stage } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0][4].args.authoring_status).toBe("model-budget");
    expect(screen.getByText(/complete rewrite cannot fit/)).toBeVisible();
    expect(
      (stage.mock.calls.at(-1)?.[0] as WordDocumentCapture).authoring?.issue,
    ).toBe("model-budget");
  });
  it("reports an estimate failure without blaming model capacity and recovers on a new request", async () => {
    mocks.estimate.mockRejectedValueOnce({
      status: 500,
      payload: "private backend details",
    });
    const { send, stage } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0][4].args.authoring_status).toBe(
      "budget-unavailable (estimate-http-500)",
    );
    expect(screen.getByText(/model context check failed/)).toBeVisible();
    expect(screen.queryByText(/choose a model with more context/)).toBeNull();
    const capture = stage.mock.calls.at(-1)?.[0] as WordDocumentCapture;
    expect(capture.authoring).toMatchObject({
      issue: "budget-unavailable",
      issueDetails: ["estimate-http-500"],
    });
    const result = await mocks.tool?.(
      { snapshot: capture.authoring?.token },
      { toolCallId: "failed-read", messageId: "message-A", chatId: "chat-A" },
    );
    expect(result?.ok).toBe(false);
    expect(JSON.stringify(result)).toContain("estimate-http-500");
    expect(JSON.stringify(result)).not.toContain("private backend details");

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][4].args.authoring_status).toBe("available");
    expect(screen.queryByText(/model context check failed/)).toBeNull();
    const refreshed = stage.mock.calls.at(-1)?.[0] as WordDocumentCapture;
    const read = await mocks.tool?.(
      { snapshot: refreshed.authoring?.token },
      { toolCallId: "retry-read", messageId: "message-B", chatId: "chat-A" },
    );
    expect(read?.ok).toBe(true);
  });
  it("does not attach the captured body if inclusion is turned off during preparation", async () => {
    let resolveBudget: ((value: unknown) => void) | undefined;
    mocks.estimate.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBudget = resolve;
        }),
    );
    const { send, stage } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mocks.estimate).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("word-include-document-chip"));
    await act(async () => {
      resolveBudget?.({ stats: { total_tokens: 5000, max_tokens: 128000 } });
    });
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0][4]).toBeUndefined();
    expect(stage.mock.calls.at(-1)?.[0]).toBeNull();
  });
  it("holds duplicate sends while the document budget is being prepared", async () => {
    let resolveBudget: ((value: unknown) => void) | undefined;
    mocks.estimate.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBudget = resolve;
        }),
    );
    const { send } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mocks.estimate).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await act(async () => {
      resolveBudget?.({ stats: { total_tokens: 5000, max_tokens: 128000 } });
    });
    expect(send).toHaveBeenCalledOnce();
    expect(mocks.estimate).toHaveBeenCalledOnce();
  });
});
