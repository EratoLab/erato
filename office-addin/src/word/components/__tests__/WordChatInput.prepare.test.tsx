import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WordChatInput } from "../WordChatInput";

import type { AddinChatInputRenderProps } from "../../../core/AddinChatCore";
import type { WordDocumentBuild } from "../../utils/buildWordDocumentArgs";
import type { WordDocumentCapture } from "../../utils/wordDocumentCapture";

const host = vi.hoisted(() => ({
  advertised: [] as string[],
  fileIds: undefined as string[] | undefined,
  capture: vi.fn(),
  budget: vi.fn(),
  images: vi.fn(),
  session: { activate: vi.fn(), clear: vi.fn(), execute: vi.fn() },
}));

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock({
    useFacets: () => ({
      data: { action_facets: host.advertised.map((id) => ({ id })) },
    }),
  });
});

vi.mock("../../../core/AddinChatInputCore", () => ({
  AddinChatInputCore: ({
    onSendMessage,
  }: {
    onSendMessage: (message: string, inputFileIds?: string[]) => void;
  }) => (
    <button
      type="button"
      data-testid="send"
      onClick={() => onSendMessage("hi", host.fileIds)}
    >
      send
    </button>
  ),
}));

vi.mock("../../hooks/useWordDocumentSource", () => ({
  useWordDocumentSource: () => ({
    preview: { status: "ready", coverage: null, changedSinceLastSend: false },
    capture: host.capture,
  }),
}));

vi.mock("../../utils/wordAuthoringBudget", () => ({
  checkWordAuthoringBudget: host.budget,
}));

vi.mock("../../utils/wordImageAssets", () => ({
  captureWordImageAssets: host.images,
}));

vi.mock("../../utils/wordDocumentReadTool", () => ({
  WORD_READ_TOOL: "read_document_blocks",
  wordDocumentReadSession: host.session,
}));

vi.mock("../../utils/wordDocumentReadRequest", () => ({
  bindWordDocumentReadRequest: () => () => {},
}));

vi.mock("../../utils/wordDocumentSubmission", () => ({
  WORD_SUBMIT_PLAN_TOOL: "submit_document_plan",
  createWordDocumentSubmissionExecutor: () => vi.fn(),
}));

vi.mock("../../utils/wordActionFacet", () => ({
  WORD_AUTHORING_FACET_ID: "word_document_authoring",
  WORD_COMPOSE_FACET_ID: "word_compose",
  WORD_DOCUMENT_REVIEW_FACET_ID: "word_document_review",
  resolveWordActionFacet: (input: {
    documentArgs: unknown;
    authoring?: { issue?: string };
  }) =>
    input.documentArgs === null
      ? undefined
      : {
          id: input.authoring
            ? "word_document_authoring"
            : "word_document_review",
          args: { authoring_status: input.authoring?.issue ?? "available" },
        },
}));

type SendCall = Parameters<AddinChatInputRenderProps["onSendMessage"]>;
type Prepared = Awaited<ReturnType<NonNullable<SendCall[11]>["run"]>>;

const IDENTITY = "https://contoso.sharepoint.com/Shared%20Documents/a.docx";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const authoringBuild = (): WordDocumentBuild =>
  ({
    args: { document_text: "[1] Text" },
    coverage: { hasContent: true, paragraphsSent: 1 },
    ordinalMap: new Map(),
    renderedOrdinals: new Set([1]),
    partialOrdinal: null,
    authoring: { token: "snapshot-1" },
  }) as unknown as WordDocumentBuild;

describe("WordChatInput prepared send", () => {
  let handedOver: SendCall[];
  let staged: (WordDocumentCapture | null)[];

  const props = (chatId: string): AddinChatInputRenderProps =>
    ({
      chatId,
      onSendMessage: (...args: SendCall) => handedOver.push(args),
    }) as unknown as AddinChatInputRenderProps;

  const renderInput = (documentIdentity = IDENTITY) =>
    render(
      <WordChatInput
        chatInputProps={props("chat-1")}
        documentIdentity={documentIdentity}
        stagePendingCapture={(capture) => staged.push(capture)}
      />,
    );

  const includeDocument = () =>
    fireEvent.click(screen.getByTestId("word-include-document-chip"));
  const send = () => fireEvent.click(screen.getByTestId("send"));
  const preparation = () => {
    const prepare = handedOver.at(-1)?.[11];
    if (!prepare) throw new Error("the send was not prepared");
    return prepare;
  };

  beforeEach(() => {
    i18n.activate("en");
    host.advertised = ["word_document_review", "word_document_authoring"];
    host.fileIds = undefined;
    host.capture.mockReset();
    host.budget.mockReset().mockResolvedValue({ ok: true });
    host.images.mockReset().mockResolvedValue({ assets: [], unavailable: [] });
    handedOver = [];
    staged = [];
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("captures the document and images together after handing the message over", async () => {
    host.fileIds = ["image-1"];
    const capture = deferred<WordDocumentBuild>();
    host.capture.mockReturnValue(capture.promise);
    host.images.mockResolvedValue({
      assets: [{ id: "asset-1" }],
      unavailable: [],
    });
    renderInput();
    includeDocument();

    send();
    expect(handedOver).toHaveLength(1);
    expect(host.capture).not.toHaveBeenCalled();

    let result: Promise<Prepared> | undefined;
    act(() => {
      result = preparation().run(new AbortController().signal);
    });
    expect(host.capture).toHaveBeenCalledTimes(1);
    expect(host.images).toHaveBeenCalledWith(["image-1"]);

    const build = authoringBuild();
    await act(async () => {
      capture.resolve(build);
      await result;
    });

    const prepared = await result;
    expect(prepared?.actionFacet?.id).toBe("word_document_authoring");
    expect(prepared?.hostContextIdentity).toBe(IDENTITY);
    expect(build.authoring?.assets).toEqual([{ id: "asset-1" }]);
    expect(host.budget).toHaveBeenCalledTimes(1);
    expect(host.session.activate).toHaveBeenCalledWith(
      build.authoring,
      undefined,
      expect.any(Function),
    );
    expect(staged.at(-1)?.identity).toBe(IDENTITY);
  });

  it("still sends after a budget refusal, reporting it as the authoring status", async () => {
    host.capture.mockResolvedValue(authoringBuild());
    host.budget.mockResolvedValue({ ok: false, issue: "model-budget" });
    renderInput();
    includeDocument();
    send();

    let prepared = null as Prepared;
    await act(async () => {
      prepared = await preparation().run(new AbortController().signal);
    });

    expect(prepared?.actionFacet?.args?.authoring_status).toBe("model-budget");
  });

  it("drops the send when the document changes during preparation", async () => {
    const capture = deferred<WordDocumentBuild>();
    host.capture.mockReturnValue(capture.promise);
    const { rerender } = renderInput();
    includeDocument();
    send();

    let result: Promise<Prepared> | undefined;
    act(() => {
      result = preparation().run(new AbortController().signal);
    });
    rerender(
      <WordChatInput
        chatInputProps={props("chat-1")}
        documentIdentity="pane-session:another-document"
        stagePendingCapture={(capture) => staged.push(capture)}
      />,
    );
    await act(async () => {
      capture.resolve(authoringBuild());
      await result;
    });

    expect(await result).toBeNull();
    expect(host.session.activate).not.toHaveBeenCalled();
    act(() => preparation().onAbandoned?.());
    expect(staged.at(-1)).toBeNull();
    expect(host.session.clear).toHaveBeenCalled();
  });

  it("drops the send when it is stopped during preparation", async () => {
    const capture = deferred<WordDocumentBuild>();
    host.capture.mockReturnValue(capture.promise);
    renderInput();
    includeDocument();
    send();

    const controller = new AbortController();
    let result: Promise<Prepared> | undefined;
    act(() => {
      result = preparation().run(controller.signal);
    });
    controller.abort();
    await act(async () => {
      capture.resolve(authoringBuild());
      await result;
    });

    expect(await result).toBeNull();
    expect(host.budget).not.toHaveBeenCalled();
  });

  it("sends without the document when it cannot be read", async () => {
    host.capture.mockRejectedValue(new Error("GeneralException"));
    renderInput();
    includeDocument();
    send();

    let prepared = null as Prepared;
    await act(async () => {
      prepared = await preparation().run(new AbortController().signal);
    });

    expect(prepared).toEqual({
      actionFacet: undefined,
      hostContextIdentity: null,
    });
    expect(staged.at(-1)).toBeNull();
  });

  it("does not fetch images when document authoring is unavailable", async () => {
    host.advertised = ["word_document_review"];
    host.fileIds = ["image-1"];
    host.capture.mockResolvedValue({
      ...authoringBuild(),
      authoring: undefined,
    });
    renderInput();
    includeDocument();
    send();

    await act(async () => {
      await preparation().run(new AbortController().signal);
    });

    expect(host.images).not.toHaveBeenCalled();
    expect(host.budget).not.toHaveBeenCalled();
  });

  it("ignores a second send until the first preparation settles", async () => {
    const capture = deferred<WordDocumentBuild>();
    host.capture.mockReturnValue(capture.promise);
    renderInput();
    includeDocument();

    send();
    send();
    expect(handedOver).toHaveLength(1);

    let result: Promise<Prepared> | undefined;
    act(() => {
      result = preparation().run(new AbortController().signal);
    });
    await act(async () => {
      capture.resolve(authoringBuild());
      await result;
    });

    host.capture.mockResolvedValue(authoringBuild());
    send();
    expect(handedOver).toHaveLength(2);
  });

  it("unlocks sending again after a dropped send", () => {
    renderInput();
    includeDocument();
    send();

    act(() => preparation().onAbandoned?.());
    send();

    expect(handedOver).toHaveLength(2);
  });
});
