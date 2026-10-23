import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContextLaneDouble } from "../../../test/helpers/contextLaneDouble";
import { wordContextStore } from "../../hooks/wordContextStore";
import {
  WORD_SEND_CAPTURE_DEADLINE_MS,
  WORD_SEND_SKIP_OFFER_MS,
  WordChatInput,
} from "../WordChatInput";

import type { AddinChatInputRenderProps } from "../../../core/AddinChatCore";
import type { WordDocumentPreview } from "../../hooks/useWordDocumentSource";
import type { WordDocumentBuild } from "../../utils/buildWordDocumentArgs";
import type * as wordActionFacetModule from "../../utils/wordActionFacet";
import type { ComposerContextItem } from "@erato/frontend/library";
import type { WordDocumentCapture } from "@erato/frontend/word-review";

const host = vi.hoisted(() => {
  const readyPreview: WordDocumentPreview = {
    status: "included",
    coverage: {
      hasContent: true,
      truncated: false,
      partialParagraph: false,
      paragraphsSent: 1,
      paragraphsTotal: 1,
    },
    changedSinceLastSend: false,
    reading: false,
  };
  return {
    advertised: [] as string[],
    facetInputs: [] as { trackChanges?: boolean }[],
    fileIds: undefined as string[] | undefined,
    readyPreview,
    preview: readyPreview,
    capture: vi.fn(),
    captureExpectedSlow: vi.fn(),
    previousCapture: vi.fn(),
    markSent: vi.fn(),
    retry: vi.fn(),
    budget: vi.fn(),
    images: vi.fn(),
    session: { activate: vi.fn(), clear: vi.fn(), execute: vi.fn() },
  };
});

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  const { AlertMock } = await import("../../../test/helpers/contextLaneDouble");
  return mock.createEratoLibraryMock({
    useFacets: () => ({
      data: { action_facets: host.advertised.map((id) => ({ id })) },
    }),
    Alert: AlertMock,
  });
});

vi.mock("../../../core/AddinChatInputCore", () => ({
  AddinChatInputCore: ({
    onSendMessage,
    disabled,
    contextItems,
  }: {
    onSendMessage: (message: string, inputFileIds?: string[]) => void;
    disabled?: boolean;
    contextItems?: ComposerContextItem[];
  }) => (
    <>
      <ContextLaneDouble items={contextItems} />
      <button
        type="button"
        data-testid="send"
        data-composer-disabled={String(disabled === true)}
        onClick={() => onSendMessage("hi", host.fileIds)}
      >
        send
      </button>
    </>
  ),
}));

vi.mock("../../hooks/useWordDocumentSource", () => ({
  useWordDocumentSource: () => ({
    preview: host.preview,
    capture: host.capture,
    captureExpectedSlow: host.captureExpectedSlow,
    previousCapture: host.previousCapture,
    markSent: host.markSent,
    retry: host.retry,
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
    trackChanges?: boolean;
  }) => {
    host.facetInputs.push(input);
    return input.documentArgs === null
      ? undefined
      : {
          id: input.authoring
            ? "word_document_authoring"
            : "word_document_review",
          args: { authoring_status: input.authoring?.issue ?? "available" },
        };
  },
}));

type SendCall = Parameters<AddinChatInputRenderProps["onSendMessage"]>;
type Prepared = Awaited<ReturnType<NonNullable<SendCall[11]>["run"]>>;

const IDENTITY = "https://contoso.sharepoint.com/Shared%20Documents/a.docx";
const WITHOUT_DOCUMENT = { actionFacet: undefined, hostContextIdentity: null };

const chip = () => screen.getByTestId("context-chip-word.document");
const meta = () =>
  within(chip()).queryByTestId("context-chip-meta")?.textContent;
const detail = () => screen.getByTestId("context-detail-word.document");
/** The document's lasting facts, as its detail lists them. */
const notes = () =>
  [...detail().querySelectorAll('[data-ui="word-context-detail-note"]')].map(
    (note) => note.textContent,
  );
/** The one-off send prompts above the composer. */
const oneOffAlerts = () => {
  const rows = screen.queryByTestId("word-one-off-rows");
  return rows
    ? within(rows)
        .queryAllByRole("alert")
        .map((alert) => alert.textContent)
    : [];
};

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
    host.facetInputs = [];
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
    wordContextStore.resetForTests();
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
    // The Send's own check says to send again: a one-off row, not a fact on the chip.
    expect(oneOffAlerts()).toEqual([
      "The complete rewrite cannot fit the selected model’s available context. Start a shorter chat or choose a model with more context.",
    ]);
    expect(chip()).not.toHaveAttribute("data-tone");
    expect(notes()).toEqual([]);
  });

  it("keeps the capture's own authoring issue over a budget refusal", async () => {
    host.capture.mockResolvedValue(authoringBuild({ issue: "unsupported" }));
    host.budget.mockResolvedValue({ ok: false, issue: "model-budget" });
    renderInput();
    send();

    const prepared = await settle(startPreparation());

    expect(prepared?.actionFacet).toMatchObject({
      id: "word_document_authoring",
      args: { authoring_status: "unsupported" },
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
    expect(screen.queryByTestId("word-one-off-rows")).toBeNull();
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

  it("shows the document loading while Word is handing it over, still removable", () => {
    host.preview = { ...host.readyPreview, reading: true };
    renderInput();

    expect(chip()).toHaveAttribute("data-state", "loading");
    expect(meta()).toBe("Reading document…");
    expect(
      within(chip()).getByRole("button", {
        name: "Don't include this document",
      }),
    ).toBeEnabled();
  });

  it("shows the document included once it is read", () => {
    renderInput();

    expect(chip()).toHaveAttribute("data-state", "included");
  });

  it("says the document changed since the last send", () => {
    host.preview = { ...host.readyPreview, changedSinceLastSend: true };
    renderInput();

    expect(meta()).toBe("Changed since last send");
    expect(detail()).toHaveTextContent(
      "Changed since last send: Erato reads it again with this message.",
    );
  });

  it("puts the only-the-beginning hint under the coverage it explains, before the change note", () => {
    host.advertised = ["word_document_review"];
    host.preview = {
      ...host.readyPreview,
      coverage: {
        hasContent: true,
        truncated: true,
        partialParagraph: false,
        paragraphsSent: 120,
        paragraphsTotal: 300,
      },
      changedSinceLastSend: true,
    };
    renderInput();

    const coverage = detail().querySelector(
      '[data-ui="word-context-detail-coverage"]',
    );
    expect(
      [...coverage!.querySelectorAll("p")].map((line) => line.textContent),
    ).toEqual([
      "Erato receives the first 120 of 300 paragraphs.",
      "Only the beginning is sent. To work on a later part, select it in Word.",
      "Changed since last send: Erato reads it again with this message.",
    ]);
  });

  it("redraws an open detail when the document's facts change", () => {
    host.advertised = ["word_document_review"];
    host.preview = {
      ...host.readyPreview,
      coverage: {
        hasContent: true,
        truncated: false,
        partialParagraph: false,
        paragraphsSent: 3,
        paragraphsTotal: 3,
      },
    };
    const view = renderInput();
    expect(detail()).toHaveTextContent(
      "Erato receives the whole document, 3 paragraphs.",
    );

    host.preview = {
      ...host.preview,
      coverage: {
        ...host.preview.coverage!,
        paragraphsSent: 4,
        paragraphsTotal: 4,
      },
    };
    view.rerender(
      <WordChatInput
        chatInputProps={props("chat-1")}
        documentIdentity={IDENTITY}
        stagePendingCapture={(capture) => staged.push(capture)}
      />,
    );

    expect(detail()).toHaveTextContent(
      "Erato receives the whole document, 4 paragraphs.",
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

  it("stops waiting for Word as soon as the document is removed with its (x)", async () => {
    host.capture.mockReturnValue(neverSettles());
    renderInput();
    send();
    const result = startPreparation();

    fireEvent.click(
      within(chip()).getByRole("button", {
        name: "Don't include this document",
      }),
    );

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
    [
      "tracking",
      "tracking",
      "Track Changes is on, so Erato reads this document as if every tracked change were accepted, without seeing who changed what, and doesn't edit it.",
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
      expect(notes()).toContain(warning);
      expect(chip()).toHaveAttribute("data-tone", "warning");
      expect(oneOffAlerts()).toEqual([]);
    },
  );

  it("marks a capture read under Track Changes so its edits are not offered", async () => {
    host.capture.mockResolvedValue(authoringBuild({ issue: "tracking" }));
    renderInput();
    send();
    await settle(startPreparation());

    expect(staged.at(-1)).toMatchObject({ trackChanges: true });

    host.capture.mockResolvedValue(
      authoringBuild({
        issue: "unavailable",
        issueDetails: ["package-failed"],
      }),
    );
    send();
    await settle(startPreparation());

    expect(staged.at(-1)).not.toHaveProperty("trackChanges");
  });

  const TRACKING_NOTICE =
    "Track Changes is on, so Erato reads this document as if every tracked change were accepted, without seeing who changed what, and doesn't edit it.";
  it.each([
    [
      "too-large",
      "package-too-large",
      "The file is also too large for Erato to open completely, so Erato receives only the included text.",
      "This file is too large for Erato to open completely. Erato receives only the included text and can reword it, but not change its structure or formatting.",
    ],
    [
      "unavailable",
      "package-timeout",
      "Word did not hand over the complete document, so Erato can read its text but not edit it. Send again to retry.",
      "Word did not hand over the complete document, so Erato can read its text but not edit it. Send again to retry.",
    ],
    [
      "unavailable",
      "package-failed",
      "Word did not hand over the complete document, so Erato can read its text but not edit it. Send again to retry.",
      "Word did not hand over the complete document, so Erato can read its text but not edit it. Send again to retry.",
    ],
    [
      "unavailable",
      "package-unsupported",
      "Erato cannot edit this document's file structure, so it can only read its text.",
      "Erato cannot edit this document's file structure, so it can only read its text.",
    ],
  ])(
    "keeps Track Changes when the package fails (%s, %s)",
    async (issue, detail, trackedNotice, untrackedNotice) => {
      const failed = authoringBuild({ issue, issueDetails: [detail] });
      host.capture.mockResolvedValue({ ...failed, trackChanges: true });
      renderInput();
      send();
      const tracked = await settle(startPreparation());

      expect(tracked?.actionFacet?.id).toBe("word_document_review");
      expect(host.facetInputs.at(-1)?.trackChanges).toBe(true);
      expect(staged.at(-1)).toMatchObject({ trackChanges: true });
      expect(notes()).toEqual([TRACKING_NOTICE, trackedNotice]);
      expect(meta()).toMatch(/^Track Changes on/);

      host.capture.mockResolvedValue(failed);
      send();
      const untracked = await settle(startPreparation());

      expect(untracked?.actionFacet?.id).toBe("word_document_review");
      expect(host.facetInputs.at(-1)?.trackChanges).toBe(false);
      expect(staged.at(-1)).not.toHaveProperty("trackChanges");
      expect(notes()).toEqual([untrackedNotice]);
      expect(meta()).toMatch(/^Read only/);
    },
  );

  it("says Track Changes is on for a review read without authoring", async () => {
    host.advertised = ["word_document_review"];
    host.capture.mockResolvedValue({
      ...authoringBuild(),
      authoring: undefined,
      trackChanges: true,
    });
    renderInput();
    send();
    const prepared = await settle(startPreparation());

    expect(prepared?.actionFacet?.id).toBe("word_document_review");
    expect(host.facetInputs.at(-1)?.trackChanges).toBe(true);
    expect(staged.at(-1)).toMatchObject({ trackChanges: true });
    expect(notes()).toEqual([TRACKING_NOTICE]);
    expect(meta()).toBe("Track Changes on · 1 ¶");
    expect(chip()).toHaveAttribute("data-tone", "warning");
  });

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
    expect(notes()).toEqual([
      "This file is too large for Erato to open, so Erato cannot read or edit it.",
    ]);
    expect(meta()).toBe("Can't edit · 1 ¶");
  });

  const PACKAGE_BLOCKED =
    "Word for the web didn't hand over the complete file, for example because the document has a sensitivity label. Erato read the body only, so it can't change headers, footers or page layout, and any change replaces the whole body instead of editing passages in place.";
  const readNote = () => screen.queryByTestId("word-document-read-note");

  it("says before sending that Erato reads only the body of a labelled document", () => {
    host.preview = { ...host.readyPreview, authoringNote: "package-blocked" };
    renderInput();

    expect(readNote()).toHaveTextContent(PACKAGE_BLOCKED);
    expect(within(detail()).getByTestId("word-document-read-note")).toBe(
      readNote(),
    );
    expect(meta()).toBe("Body only · 1 ¶");
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
    expect(meta()).toBe("Read in parts · 1 ¶");
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
  const hint = () => screen.queryByTestId("word-document-coverage-hint");

  beforeEach(() => i18n.activate("en"));
  afterEach(() => {
    cleanup();
    wordContextStore.resetForTests();
  });

  it("keeps the paragraph count and points to a selection when only the review excerpt is sent", () => {
    renderWith(["word_document_review"], { coverage: truncated });

    expect(meta()).toBe("First 453 of 1,590 ¶");
    expect(detail()).toHaveTextContent(
      "Erato receives the first 453 of 1,590 paragraphs.",
    );
    expect(hint()).toHaveTextContent(
      "Only the beginning is sent. To work on a later part, select it in Word.",
    );
  });

  it("does not claim the review excerpt's count when authoring reads the document", () => {
    renderWith(["word_document_review", "word_document_authoring"], {
      coverage: truncated,
    });

    expect(meta()).toBe("1,590 ¶");
    expect(detail()).not.toHaveTextContent("453");
    expect(detail()).toHaveTextContent(
      "Erato reads the parts of the document your request needs.",
    );
    expect(hint()).toBeNull();
  });

  it("says a document too large for a complete read is read in parts", () => {
    renderWith(["word_document_review", "word_document_authoring"], {
      coverage: truncated,
      completeReadIssue: "too-large",
    });

    expect(meta()).toBe("Read in parts · 1,590 ¶");
    expect(chip()).not.toHaveAttribute("data-tone");
    expect(hint()).toHaveTextContent(
      "This document is too large to rewrite as a whole. Erato can still read and edit it section by section.",
    );
  });

  it("does not promise reads in parts while a hard issue blocks every read", () => {
    renderWith(["word_document_review", "word_document_authoring"], {
      coverage: truncated,
      completeReadIssue: "too-large",
      authoringIssue: "unsupported",
    });

    expect(meta()).toBe("Can't edit · 1,590 ¶");
    expect(chip()).toHaveAttribute("data-tone", "warning");
    expect(hint()).toBeNull();
    expect(notes().join(" ")).toContain(
      "Word did not supply a complete editable structure for this document.",
    );
  });

  it("says a long document under Track Changes is cut, and that Erato reads the accepted text", () => {
    renderWith(["word_document_review", "word_document_authoring"], {
      coverage: truncated,
      completeReadIssue: "too-large",
      authoringIssue: "tracking",
    });

    expect(meta()).toBe("Track Changes on · First 453 of 1,590 ¶");
    expect(chip()).toHaveAttribute("data-tone", "warning");
    expect(hint()).toHaveTextContent(
      "Only the beginning is sent. To work on a later part, select it in Word.",
    );
    expect(notes()).toEqual([
      expect.stringContaining(
        "Track Changes is on, so Erato reads this document as if every tracked change were accepted",
      ),
    ]);
  });

  it("keeps the count when a file too large to open falls back to the review excerpt", () => {
    renderWith(["word_document_review", "word_document_authoring"], {
      coverage: truncated,
      authoringIssue: "too-large",
      authoringDetails: ["package-too-large"],
    });

    expect(meta()).toBe("Read only · First 453 of 1,590 ¶");
    expect(chip()).toHaveAttribute("data-tone", "warning");
    expect(notes()).toEqual([
      expect.stringContaining(
        "This file is too large for Erato to open completely.",
      ),
    ]);
  });
});
