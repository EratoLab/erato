import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WORD_SEND_CAPTURE_DEADLINE_MS,
  WORD_SEND_SKIP_OFFER_MS,
  WordChatInput,
} from "../WordChatInput";

import type { AddinChatInputRenderProps } from "../../../core/AddinChatCore";
import type { WordDocumentPreview } from "../../hooks/useWordDocumentSource";
import type { WordDocumentBuild } from "../../utils/buildWordDocumentArgs";
import type * as wordActionFacetModule from "../../utils/wordActionFacet";
import type { WordDocumentCapture } from "@erato/frontend/word-review";
import type { ReactNode } from "react";

const host = vi.hoisted(() => {
  const readyPreview: WordDocumentPreview = {
    status: "included",
    coverage: null,
    changedSinceLastSend: false,
    reading: false,
  };
  return {
    advertised: [] as string[],
    fileIds: undefined as string[] | undefined,
    readyPreview,
    preview: readyPreview,
    capture: vi.fn(),
    captureExpectedSlow: vi.fn(),
    previousCapture: vi.fn(),
    markSent: vi.fn(),
    budget: vi.fn(),
    images: vi.fn(),
    session: { activate: vi.fn(), clear: vi.fn(), execute: vi.fn() },
  };
});

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock({
    useFacets: () => ({
      data: { action_facets: host.advertised.map((id) => ({ id })) },
    }),
    Alert: ({ children }: { children: ReactNode }) => (
      <div role="alert">{children}</div>
    ),
    SpinnerIcon: ({ srText }: { srText?: string }) => (
      <span role="status">{srText}</span>
    ),
  });
});

vi.mock("../../../core/AddinChatInputCore", () => ({
  AddinChatInputCore: ({
    onSendMessage,
    disabled,
  }: {
    onSendMessage: (message: string, inputFileIds?: string[]) => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      data-testid="send"
      data-composer-disabled={String(disabled === true)}
      onClick={() => onSendMessage("hi", host.fileIds)}
    >
      send
    </button>
  ),
}));

vi.mock("../../hooks/useWordDocumentSource", () => ({
  useWordDocumentSource: () => ({
    preview: host.preview,
    capture: host.capture,
    captureExpectedSlow: host.captureExpectedSlow,
    previousCapture: host.previousCapture,
    markSent: host.markSent,
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

vi.mock("../../utils/wordActionFacet", async (importOriginal) => ({
  ...(await importOriginal<typeof wordActionFacetModule>()),
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
const WITHOUT_DOCUMENT = { actionFacet: undefined, hostContextIdentity: null };

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const authoringBuild = (
  authoring: Record<string, unknown> = {},
): WordDocumentBuild =>
  ({
    args: { document_text: "[1] Text" },
    coverage: { hasContent: true, paragraphsSent: 1 },
    ordinalMap: new Map(),
    headings: new Map(),
    renderedOrdinals: new Set([1]),
    partialOrdinal: null,
    authoring: { token: "snapshot-1", ...authoring },
  }) as unknown as WordDocumentBuild;

describe("WordChatInput prepared send", () => {
  let handedOver: SendCall[];
  let staged: (WordDocumentCapture | null)[];

  const props = (
    chatId: string,
    extra: Partial<AddinChatInputRenderProps> = {},
  ): AddinChatInputRenderProps =>
    ({
      chatId,
      onSendMessage: (...args: SendCall) => handedOver.push(args),
      ...extra,
    }) as unknown as AddinChatInputRenderProps;

  const renderInput = (
    documentIdentity = IDENTITY,
    extra: Partial<AddinChatInputRenderProps> = {},
  ) =>
    render(
      <WordChatInput
        chatInputProps={props("chat-1", extra)}
        documentIdentity={documentIdentity}
        stagePendingCapture={(capture) => staged.push(capture)}
      />,
    );

  const send = () => fireEvent.click(screen.getByTestId("send"));
  const composerDisabled = () =>
    screen.getByTestId("send").getAttribute("data-composer-disabled");
  const chip = () => screen.getByTestId("word-include-document-chip");
  const preparation = () => {
    const prepare = handedOver.at(-1)?.[11];
    if (!prepare) throw new Error("the send was not prepared");
    return prepare;
  };
  const startPreparation = (signal = new AbortController().signal) => {
    let result!: Promise<Prepared>;
    act(() => {
      result = preparation().run(signal);
    });
    return result;
  };
  const settle = async (result: Promise<Prepared>): Promise<Prepared> => {
    let prepared = null as Prepared;
    await act(async () => {
      prepared = await result;
    });
    return prepared;
  };
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  const neverSettles = () => new Promise<WordDocumentBuild>(() => {});

  beforeEach(() => {
    i18n.activate("en");
    host.advertised = ["word_document_review", "word_document_authoring"];
    host.fileIds = undefined;
    host.preview = { ...host.readyPreview };
    host.capture.mockReset();
    host.captureExpectedSlow.mockReset().mockReturnValue(false);
    host.previousCapture.mockReset().mockReturnValue(null);
    host.budget.mockReset().mockResolvedValue({ ok: true });
    host.images.mockReset().mockResolvedValue({ assets: [], unavailable: [] });
    handedOver = [];
    staged = [];
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("captures the document, images and the budget check together after handing the message over", async () => {
    host.fileIds = ["image-1"];
    const capture = deferred<WordDocumentBuild>();
    host.capture.mockReturnValue(capture.promise);
    host.images.mockResolvedValue({
      assets: [{ id: "asset-1" }],
      unavailable: [],
    });
    renderInput();

    send();
    expect(handedOver).toHaveLength(1);
    expect(host.capture).not.toHaveBeenCalled();
    expect(host.budget).not.toHaveBeenCalled();

    const signal = new AbortController().signal;
    const result = startPreparation(signal);
    expect(host.capture).toHaveBeenCalledTimes(1);
    expect(host.images).toHaveBeenCalledWith(["image-1"]);
    expect(host.budget).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        message: "hi",
        chatId: "chat-1",
        signal: expect.any(AbortSignal),
      }),
    );

    const build = authoringBuild();
    capture.resolve(build);
    const prepared = await settle(result);

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
    send();

    const prepared = await settle(startPreparation());

    expect(prepared?.actionFacet?.args?.authoring_status).toBe("model-budget");
  });

  it("keeps the capture's own authoring issue over a budget refusal", async () => {
    host.capture.mockResolvedValue(authoringBuild({ issue: "tracking" }));
    host.budget.mockResolvedValue({ ok: false, issue: "model-budget" });
    renderInput();
    send();

    const prepared = await settle(startPreparation());

    expect(prepared?.actionFacet).toMatchObject({
      id: "word_document_authoring",
      args: { authoring_status: "tracking" },
    });
  });

  it("ignores a budget refusal when the capture has no authoring", async () => {
    host.capture.mockResolvedValue({
      ...authoringBuild(),
      authoring: undefined,
    });
    host.budget.mockResolvedValue({ ok: false, issue: "model-budget" });
    renderInput();
    send();

    const prepared = await settle(startPreparation());

    expect(prepared?.actionFacet).toMatchObject({
      id: "word_document_review",
      args: { authoring_status: "available" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears a prepared capture when the document identity changes", async () => {
    host.capture.mockResolvedValue(authoringBuild());
    const { rerender } = renderInput();
    send();
    await settle(startPreparation());
    expect(host.session.activate).toHaveBeenCalledTimes(1);
    host.session.clear.mockClear();
    host.capture.mockClear();
    host.session.activate.mockClear();

    rerender(
      <WordChatInput
        chatInputProps={props("chat-1")}
        documentIdentity="pane-session:another-document"
        stagePendingCapture={(capture) => staged.push(capture)}
      />,
    );

    expect(host.session.clear).toHaveBeenCalledTimes(1);
    expect(host.capture).not.toHaveBeenCalled();
    expect(host.session.activate).not.toHaveBeenCalled();
  });

  it("drops the send when the document changes during preparation", async () => {
    const capture = deferred<WordDocumentBuild>();
    host.capture.mockReturnValue(capture.promise);
    const { rerender } = renderInput();
    send();

    const result = startPreparation();
    rerender(
      <WordChatInput
        chatInputProps={props("chat-1")}
        documentIdentity="pane-session:another-document"
        stagePendingCapture={(capture) => staged.push(capture)}
      />,
    );
    capture.resolve(authoringBuild());

    expect(await settle(result)).toBeNull();
    expect(host.session.activate).not.toHaveBeenCalled();
    act(() => preparation().onAbandoned?.());
    expect(staged.at(-1)).toBeNull();
    expect(host.session.clear).toHaveBeenCalled();
  });

  it("drops the send as soon as it is stopped, without waiting for Word", async () => {
    host.capture.mockReturnValue(neverSettles());
    renderInput();
    send();

    const controller = new AbortController();
    const result = startPreparation(controller.signal);
    act(() => controller.abort());

    expect(await settle(result)).toBeNull();
    expect(host.budget.mock.calls[0][1].signal.aborted).toBe(true);
    expect(host.session.activate).not.toHaveBeenCalled();
  });

  it("sends without the document when it cannot be read", async () => {
    host.capture.mockRejectedValue(new Error("GeneralException"));
    renderInput();
    send();

    const prepared = await settle(startPreparation());

    expect(prepared).toEqual(WITHOUT_DOCUMENT);
    expect(staged.at(-1)).toBeNull();
  });

  it("does not fetch images or check the budget when document authoring is unavailable", async () => {
    host.advertised = ["word_document_review"];
    host.fileIds = ["image-1"];
    host.capture.mockResolvedValue({
      ...authoringBuild(),
      authoring: undefined,
    });
    renderInput();
    send();

    await settle(startPreparation());

    expect(host.images).not.toHaveBeenCalled();
    expect(host.budget).not.toHaveBeenCalled();
  });

  it("ignores a second send until the first preparation settles", async () => {
    const capture = deferred<WordDocumentBuild>();
    host.capture.mockReturnValue(capture.promise);
    renderInput();

    send();
    send();
    expect(handedOver).toHaveLength(1);

    const result = startPreparation();
    capture.resolve(authoringBuild());
    await settle(result);

    host.capture.mockResolvedValue(authoringBuild());
    send();
    expect(handedOver).toHaveLength(2);
  });

  it("unlocks sending again after a dropped send", () => {
    renderInput();
    send();

    act(() => preparation().onAbandoned?.());
    send();

    expect(handedOver).toHaveLength(2);
  });

  it("leaves the composer usable while a send is being prepared", () => {
    host.capture.mockReturnValue(neverSettles());
    renderInput();

    send();
    void startPreparation();

    expect(composerDisabled()).toBe("false");
  });

  it("passes the host's disabled state to the composer unchanged", () => {
    renderInput(IDENTITY, { disabled: true });

    expect(composerDisabled()).toBe("true");
  });

  it.each([
    [true, "Reading document…"],
    [false, undefined],
  ])(
    "labels the send by whether the capture is expected to be slow (%s)",
    (slow, label) => {
      host.captureExpectedSlow.mockReturnValue(slow);
      renderInput();

      send();

      expect(preparation().label).toBe(label);
    },
  );

  it("shows a spinner in the chip while Word is handing over the document", () => {
    host.preview = { ...host.readyPreview, reading: true };
    renderInput();

    expect(screen.getByRole("status")).toHaveTextContent("Reading document…");
  });

  it("shows no spinner once the document is read", () => {
    renderInput();

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says the document changed since the last send", () => {
    host.preview = { ...host.readyPreview, changedSinceLastSend: true };
    renderInput();

    expect(chip()).toHaveTextContent(
      "Document included - changed since last send",
    );
  });

  it("offers to send without the document once the capture is slow, and does so on request", async () => {
    vi.useFakeTimers();
    host.capture.mockReturnValue(neverSettles());
    renderInput();
    send();
    const result = startPreparation();

    await advance(WORD_SEND_SKIP_OFFER_MS - 1);
    expect(screen.queryByTestId("word-slow-capture")).toBeNull();
    await advance(1);
    expect(screen.getByTestId("word-slow-capture")).toHaveTextContent(
      "Word is still handing over the document.",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Send without document" }),
    );

    expect(await settle(result)).toEqual(WITHOUT_DOCUMENT);
    expect(staged.at(-1)).toBeNull();
    expect(host.session.activate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("word-slow-capture")).toBeNull();
  });

  it("withdraws the offer when the capture arrives in time", async () => {
    vi.useFakeTimers();
    const capture = deferred<WordDocumentBuild>();
    host.capture.mockReturnValue(capture.promise);
    renderInput();
    send();
    const result = startPreparation();
    await advance(WORD_SEND_SKIP_OFFER_MS);
    expect(screen.getByTestId("word-slow-capture")).toBeInTheDocument();

    capture.resolve(authoringBuild());
    const prepared = await settle(result);

    expect(prepared?.actionFacet?.id).toBe("word_document_authoring");
    expect(screen.queryByTestId("word-slow-capture")).toBeNull();
  });

  it("stops waiting for Word as soon as the document is removed with ✕", async () => {
    host.capture.mockReturnValue(neverSettles());
    renderInput();
    send();
    const result = startPreparation();

    fireEvent.click(screen.getByTestId("word-exclude-document"));

    expect(await settle(result)).toEqual(WITHOUT_DOCUMENT);
    expect(host.markSent).not.toHaveBeenCalled();
    expect(host.budget.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("drops a send still waiting in the chat being left, so the next chat can send", async () => {
    host.capture.mockReturnValue(neverSettles());
    const { rerender } = renderInput();
    send();
    const result = startPreparation();

    rerender(
      <WordChatInput
        chatInputProps={props("chat-2")}
        documentIdentity={IDENTITY}
        stagePendingCapture={(capture) => staged.push(capture)}
      />,
    );

    expect(await settle(result)).toBeNull();
    send();
    expect(handedOver).toHaveLength(2);
  });

  it.each([
    ["has no authoring", () => ({ ...authoringBuild(), authoring: undefined })],
    [
      "has an editing issue",
      () => {
        const build = authoringBuild();
        build.authoring!.issue = "tracking";
        return build;
      },
    ],
  ])(
    "neither waits for nor keeps the token estimate when the capture %s",
    async (_, build) => {
      host.budget.mockReturnValue(new Promise(() => {}));
      host.capture.mockResolvedValue(build());
      renderInput();
      send();

      const prepared = await settle(startPreparation());

      expect(prepared).not.toBeNull();
      expect(host.budget.mock.calls[0][1].signal.aborted).toBe(true);
    },
  );

  it("records the capture a send carried for the changed-since-last-send label", async () => {
    const build = authoringBuild();
    host.capture.mockResolvedValue(build);
    renderInput();
    send();

    await settle(startPreparation());

    expect(host.markSent).toHaveBeenCalledWith(build);
  });

  it("sends an earlier capture when Word misses the deadline, and says so", async () => {
    vi.useFakeTimers();
    host.capture.mockReturnValue(neverSettles());
    const earlier = authoringBuild();
    host.previousCapture.mockReturnValue(earlier);
    renderInput();
    send();
    const result = startPreparation();

    await advance(WORD_SEND_CAPTURE_DEADLINE_MS);
    const prepared = await settle(result);

    expect(prepared?.actionFacet?.id).toBe("word_document_authoring");
    expect(prepared?.hostContextIdentity).toBe(IDENTITY);
    expect(host.session.activate).toHaveBeenCalledWith(
      earlier.authoring,
      undefined,
      expect.any(Function),
    );
    expect(staged.at(-1)?.identity).toBe(IDENTITY);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reading the document took too long, so Erato used an earlier copy. Recent edits may be missing.",
    );
  });

  it("sends without the document when Word misses the deadline and no earlier capture exists, and says so", async () => {
    vi.useFakeTimers();
    host.capture.mockReturnValue(neverSettles());
    renderInput();
    send();
    const result = startPreparation();

    await advance(WORD_SEND_CAPTURE_DEADLINE_MS - 1);
    expect(screen.queryByRole("alert")).toBeNull();
    await advance(1);

    expect(await settle(result)).toEqual(WITHOUT_DOCUMENT);
    expect(staged.at(-1)).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reading the document took too long, so this message was sent without it.",
    );
  });

  it("clears the deadline notice on the next send", async () => {
    vi.useFakeTimers();
    host.capture.mockReturnValue(neverSettles());
    renderInput();
    send();
    const result = startPreparation();
    await advance(WORD_SEND_CAPTURE_DEADLINE_MS);
    await settle(result);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    host.capture.mockResolvedValue(authoringBuild());
    send();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    [
      "too-large",
      "package-too-large",
      "This file is too large for Erato to open completely. Erato receives only the included text and can reword it, but not change its structure or formatting.",
    ],
    [
      "unavailable",
      "package-failed",
      "Word did not hand over the complete document, so Erato can read its text but not edit it. Send again to retry.",
    ],
  ])(
    "falls back to a read-only review when authoring is %s",
    async (issue, detail, warning) => {
      host.capture.mockResolvedValue(
        authoringBuild({ issue, issueDetails: [detail] }),
      );
      renderInput();
      send();

      const prepared = await settle(startPreparation());

      expect(prepared?.actionFacet?.id).toBe("word_document_review");
      expect(prepared?.hostContextIdentity).toBe(IDENTITY);
      expect(host.session.activate).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
      );
      expect(staged.at(-1)).toMatchObject({
        identity: IDENTITY,
        authoring: undefined,
        paragraphsSent: 1,
      });
      expect(screen.getByRole("alert")).toHaveTextContent(warning);
    },
  );

  it("keeps authoring with its issue when the review facet is not advertised", async () => {
    host.advertised = ["word_document_authoring"];
    host.capture.mockResolvedValue(
      authoringBuild({
        issue: "too-large",
        issueDetails: ["package-too-large"],
      }),
    );
    renderInput();
    send();

    const prepared = await settle(startPreparation());

    expect(prepared?.actionFacet).toMatchObject({
      id: "word_document_authoring",
      args: { authoring_status: "too-large" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This file is too large for Erato to open, so Erato cannot read or edit it.",
    );
  });

  const PACKAGE_BLOCKED =
    "Word for the web didn't hand over the complete file, for example because the document has a sensitivity label. Erato read the body only, so it can't change headers, footers or page layout, and any change replaces the whole body instead of editing passages in place.";
  const readNote = () => screen.queryByTestId("word-document-read-note");

  it("says before sending that Erato reads only the body of a labelled document", () => {
    host.preview = { ...host.readyPreview, authoringNote: "package-blocked" };
    renderInput();

    expect(readNote()).toHaveTextContent(PACKAGE_BLOCKED);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps saying so after a send that carried the body read on authoring", async () => {
    const build = authoringBuild({ fullDocument: false });
    build.readNote = "package-blocked";
    host.capture.mockResolvedValue(build);
    renderInput();
    send();

    const prepared = await settle(startPreparation());

    expect(prepared?.actionFacet?.id).toBe("word_document_authoring");
    expect(readNote()).toHaveTextContent(PACKAGE_BLOCKED);
  });

  it("drops the note where authoring is not offered", () => {
    host.advertised = ["word_document_review"];
    host.preview = { ...host.readyPreview, authoringNote: "package-blocked" };
    renderInput();

    expect(readNote()).toBeNull();
  });

  it("keeps a document that is only too large for a complete read on authoring, budget-checked", async () => {
    host.fileIds = ["image-1"];
    host.images.mockResolvedValue({
      assets: [{ id: "asset-1" }],
      unavailable: [],
    });
    const build = authoringBuild({ completeReadIssue: "too-large" });
    host.capture.mockResolvedValue(build);
    renderInput();
    send();

    const prepared = await settle(startPreparation());

    expect(prepared?.actionFacet).toMatchObject({
      id: "word_document_authoring",
      args: { authoring_status: "available" },
    });
    expect(host.session.activate).toHaveBeenCalledWith(
      build.authoring,
      undefined,
      expect.any(Function),
    );
    expect(build.authoring?.assets).toEqual([{ id: "asset-1" }]);
    expect(staged.at(-1)?.authoring).toBe(build.authoring);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(chip()).toHaveTextContent("Document included · read in parts");
    expect(screen.getByTestId("word-document-coverage-hint")).toHaveTextContent(
      "This document is too large to rewrite as a whole. Erato can still read and edit it section by section.",
    );
  });

  it("reports a failed scoped budget check for a document too large for a complete read", async () => {
    host.capture.mockResolvedValue(
      authoringBuild({ completeReadIssue: "too-large" }),
    );
    host.budget.mockResolvedValue({ ok: false, issue: "model-budget" });
    renderInput();
    send();

    const prepared = await settle(startPreparation());

    expect(prepared?.actionFacet?.args?.authoring_status).toBe("model-budget");
  });
});

describe("WordChatInput document coverage", () => {
  const truncated = {
    hasContent: true,
    truncated: true,
    partialParagraph: false,
    paragraphsSent: 453,
    paragraphsTotal: 1590,
  };
  const renderWith = (
    advertised: string[],
    preview: Partial<WordDocumentPreview>,
  ) => {
    host.advertised = advertised;
    host.preview = { ...host.readyPreview, ...preview };
    render(
      <WordChatInput
        chatInputProps={
          {
            chatId: "chat-1",
            onSendMessage: () => {},
          } as unknown as AddinChatInputRenderProps
        }
        documentIdentity={IDENTITY}
        stagePendingCapture={() => {}}
      />,
    );
  };
  const chip = () => screen.getByTestId("word-include-document-chip");
  const hint = () => screen.queryByTestId("word-document-coverage-hint");

  beforeEach(() => i18n.activate("en"));
  afterEach(cleanup);

  it("keeps the paragraph count and points to a selection when only the review excerpt is sent", () => {
    renderWith(["word_document_review"], { coverage: truncated });

    expect(chip()).toHaveTextContent(
      "Document included (first 453 of 1590 paragraphs)",
    );
    expect(hint()).toHaveTextContent(
      "Only the beginning is sent. To work on a later part, select it in Word.",
    );
  });

  it("does not claim the review excerpt's count when authoring reads the document", () => {
    renderWith(["word_document_review", "word_document_authoring"], {
      coverage: truncated,
    });

    expect(chip()).not.toHaveTextContent("first 453");
    expect(hint()).toBeNull();
  });

  it("says a document too large for a complete read is read in parts", () => {
    renderWith(["word_document_review", "word_document_authoring"], {
      coverage: truncated,
      completeReadIssue: "too-large",
    });

    expect(chip()).toHaveTextContent("Document included · read in parts");
    expect(hint()).toHaveTextContent(
      "This document is too large to rewrite as a whole. Erato can still read and edit it section by section.",
    );
  });

  it("does not promise reads in parts while a hard issue blocks every read", () => {
    renderWith(["word_document_review", "word_document_authoring"], {
      coverage: truncated,
      completeReadIssue: "too-large",
      authoringIssue: "tracking",
    });

    expect(chip()).not.toHaveTextContent("read in parts");
    expect(hint()).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Document restructuring is unavailable with the current Track Changes state.",
    );
  });

  it("keeps the count when a file too large to open falls back to the review excerpt", () => {
    renderWith(["word_document_review", "word_document_authoring"], {
      coverage: truncated,
      authoringIssue: "too-large",
      authoringDetails: ["package-too-large"],
    });

    expect(chip()).toHaveTextContent(
      "Document included (first 453 of 1590 paragraphs)",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This file is too large for Erato to open completely.",
    );
  });
});
