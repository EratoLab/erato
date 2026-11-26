import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createMockAsyncResult } from "../../../test/helpers/asyncResult";
import { createMockMessageCompose } from "../../../test/mocks/outlook/composeMail";
import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../../test/mocks/outlook/mailbox";
import { markOutlookFormOpened } from "../../utils/outlookProposalApply";
import { OutlookEratoEmailRenderer } from "../OutlookEratoEmailRenderer";

import type * as ComposeSelectionStore from "../../hooks/composeSelectionStore";
import type * as EratoLibrary from "@erato/frontend/library";

// The renderer's collaborators are mocked at the seams the tests steer:
// the artifact + chat snapshot (what AddinChat stamps), the current Outlook
// item identity, the user's server decisions, and the Office.js reply module —
// the tests only assert WHETHER the reply form is reached, never how.
const mockUseOutlookMailItem = vi.fn();
const mockUseOutlookArtifact = vi.fn();
const mockUseChatContext = vi.fn();
const mockOpenReplyForm = vi.fn();
const mockCopyEmailToClipboard = vi.fn();
const server = vi.hoisted(() => ({
  decisions: {},
}));
const mockComposeSelection = vi.fn(() => ({
  data: "",
  sourceProperty: "body",
}));

const realLibrary = await vi.hoisted(() =>
  vi.importActual<typeof EratoLibrary>("@erato/frontend/library"),
);

vi.mock("@erato/frontend/library", async () => ({
  Button: ({ icon: _icon, ...props }: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
  sanitizeHtmlPreview: realLibrary.sanitizeHtmlPreview,
  emailDraftHtmlToText: realLibrary.emailDraftHtmlToText,
  copyEmailToClipboard: (...args: unknown[]) =>
    Promise.resolve(mockCopyEmailToClipboard(...args)),
  useChatContext: () => mockUseChatContext(),
  ...(await import("../../../test/helpers/eratoLibraryMock")).chatHooksFrom(
    () => mockUseChatContext(),
  ),
  useOutlookArtifact: () => mockUseOutlookArtifact(),
  useApprovalTools: () => [
    { qualified_name: "outlook/open_reply", client_actions: ["outlook.reply"] },
    {
      qualified_name: "outlook/open_reply_all",
      client_actions: ["outlook.reply_all"],
    },
  ],
  useProfile: () => ({
    profile: { client_tool_decisions: server.decisions },
  }),
}));

vi.mock("../../providers/OutlookMailItemProvider", () => ({
  useOutlookMailItem: () => mockUseOutlookMailItem(),
}));

vi.mock("../../hooks/composeSelectionStore", async (importOriginal) => ({
  ...(await importOriginal<typeof ComposeSelectionStore>()),
  useComposeSelectionSnapshot: () => mockComposeSelection(),
}));

vi.mock("../../utils/outlookReadReply", () => ({
  ReplyBodyTooLargeError: class ReplyBodyTooLargeError extends Error {},
  isReplyFormHostSupported: () => true,
  openReplyForm: (...args: unknown[]) => mockOpenReplyForm(...args),
}));

const FACET = "outlook_reply_from_read";
const REPLY = "outlook.reply";

interface TestArtifact {
  facetId: string;
  bodyFormat: "text" | "html";
  renderMode: "body" | "suggestions";
  messageId: string;
  allowedClientActions: string[];
  isFreshCompletion?: boolean;
  itemIdentity?: string;
  proposedClientAction?: string;
  rewriteTarget?: { selectedText: string; sourceProperty: "body" | "subject" };
}

let nextMessageId = 0;

function makeArtifact(overrides: Partial<TestArtifact> = {}): TestArtifact {
  nextMessageId += 1;
  return {
    facetId: FACET,
    bodyFormat: "text",
    renderMode: "body",
    messageId: `msg-${nextMessageId}`,
    allowedClientActions: ["outlook.reply", "outlook.reply_all"],
    ...overrides,
  };
}

function prime(options: {
  artifact: TestArtifact;
  currentItemIdentity: string | null;
  /** The user's decisions on the server, by tool. */
  decisions?: Record<string, string>;
  /** The stored answer's parts. */
  content?: unknown[];
}) {
  mockUseOutlookArtifact.mockReturnValue(options.artifact);
  mockUseOutlookMailItem.mockReturnValue({
    mailItem: { isComposeMode: false },
    itemIdentity: options.currentItemIdentity,
  });
  mockUseChatContext.mockReturnValue({
    currentChatId: "chat-1",
    messages: {
      [options.artifact.messageId]: {
        id: options.artifact.messageId,
        role: "assistant",
        content: options.content,
      },
    },
    messageOrder: [options.artifact.messageId],
  });
  server.decisions = options.decisions ?? {};
}

beforeAll(() => {
  i18n.load("en", {});
  i18n.activate("en");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OutlookEratoEmailRenderer — wrong-item guard", () => {
  it("blocks a reply click with the stale-item error when the draft was sent from a different email", () => {
    prime({
      artifact: makeArtifact({
        isFreshCompletion: true,
        itemIdentity: "item-a",
      }),
      currentItemIdentity: "item-b",
    });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));

    expect(mockOpenReplyForm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "written for a different email",
    );
  });

  it("keeps the guard active for a regenerated draft re-seeded with the ORIGINAL exchange's identity", () => {
    // Regenerate/edit replays the ORIGINAL email (it rides in the stored
    // user message), so AddinChat seeds the new completion with the original
    // exchange's send-time identity — the artifact looks exactly like this.
    // A user who switched to another email before regenerating must still be
    // blocked: the draft was written for the original one.
    prime({
      artifact: makeArtifact({
        isFreshCompletion: true,
        itemIdentity: "item-original",
      }),
      currentItemIdentity: "item-b",
    });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));

    expect(mockOpenReplyForm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "written for a different email",
    );
  });

  it("still fails closed on a fresh completion without an identity (defense against a broken stamping invariant)", () => {
    // AddinChat no longer produces this shape — an identity-unknown
    // completion is not stamped fresh at all and degrades to a history-like
    // draft (see the dedicated describe below). The renderer keeps the
    // fail-closed rule for the OutlookArtifact contract regardless: fresh
    // without identity must never behave as unguarded.
    prime({
      artifact: makeArtifact({ isFreshCompletion: true }),
      currentItemIdentity: "item-a",
    });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));

    expect(mockOpenReplyForm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "written for a different email",
    );
  });

  it("opens the reply form when the send-time and current identities match", async () => {
    prime({
      artifact: makeArtifact({
        isFreshCompletion: true,
        itemIdentity: "item-a",
      }),
      currentItemIdentity: "item-a",
    });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    });

    expect(mockOpenReplyForm).toHaveBeenCalledWith(REPLY, "Draft body", false);
  });
});

describe("OutlookEratoEmailRenderer — identity-unknown completions degrade to history-like drafts", () => {
  // When no send-time identity is known for a regenerate/edit (e.g. after a
  // reload — the identity map is in-memory only), AddinChat does NOT stamp
  // the completion fresh. The artifact is then indistinguishable from a
  // history draft: buttons stay usable and the stale-item error never fires
  // (it requires a KNOWN mismatching identity). A click executes directly —
  // the reply form is the review surface (universal click-is-consent).

  it("executes a click directly with no stale-item error", async () => {
    prime({ artifact: makeArtifact(), currentItemIdentity: "item-a" });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    });

    expect(mockOpenReplyForm).toHaveBeenCalledWith(REPLY, "Draft body", false);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("OutlookEratoEmailRenderer — the user's decisions", () => {
  it("opens nothing on its own for a proposal, whatever the user decided for Erato", () => {
    prime({
      artifact: makeArtifact({
        isFreshCompletion: true,
        itemIdentity: "item-a",
        proposedClientAction: REPLY,
      }),
      currentItemIdentity: "item-a",
      decisions: { "outlook/open_reply": "always_allow" },
    });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    expect(mockOpenReplyForm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reply" })).toBeEnabled();
  });

  it("hides an action the user set to Never and keeps the others", () => {
    prime({
      artifact: makeArtifact(),
      currentItemIdentity: "item-a",
      decisions: { "outlook/open_reply_all": "never_allow" },
    });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    expect(screen.queryByRole("button", { name: "Reply All" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reply" })).toBeInTheDocument();
  });

  it("shows Opened! only on the button that opened the form", async () => {
    prime({ artifact: makeArtifact(), currentItemIdentity: "item-a" });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reply All" }));
    });

    expect(mockOpenReplyForm).toHaveBeenCalledWith(
      "outlook.reply_all",
      "Draft body",
      false,
    );
    expect(screen.getByRole("button", { name: "Opened!" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reply" })).toBeInTheDocument();
  });
});

describe("OutlookEratoEmailRenderer — where Erato's proposed reply stands", () => {
  const APPLY_ID = "call-propose.apply";
  const proposed = (apply?: Record<string, unknown>) => [
    { content_type: "text", text: "```erato-email\nDraft body\n```\n" },
    {
      content_type: "tool_use",
      tool_call_id: "call-propose",
      tool_name: "propose_client_action",
      status: "success",
      input: { action: REPLY },
      output: {
        apply: { call_id: APPLY_ID },
        action: REPLY,
        status: "proposed",
      },
    },
    ...(apply
      ? [
          {
            content_type: "tool_use",
            tool_call_id: APPLY_ID,
            tool_name: "open_reply",
            input: {},
            ...apply,
          },
        ]
      : []),
  ];
  const show = (
    content: unknown[],
    block = "Draft body",
    before?: (artifact: TestArtifact) => void,
  ) => {
    const artifact = makeArtifact({ proposedClientAction: REPLY });
    before?.(artifact);
    prime({ artifact, currentItemIdentity: "item-a", content });
    render(<OutlookEratoEmailRenderer content={block} isHtml={false} />);
  };

  it("says the reply waits for the decision, which stays the one primary action", () => {
    show(proposed());

    expect(screen.getByTestId("outlook-proposal-status")).toHaveTextContent(
      "Waiting for your decision",
    );
    expect(screen.getByRole("button", { name: "Reply" })).toHaveAttribute(
      "variant",
      "secondary",
    );
  });

  it("speaks only for the draft the proposal opens, and fills no button beside it", () => {
    show(
      [
        { content_type: "text", text: "```text\nAn aside\n```\n" },
        ...proposed(),
      ],
      "An aside",
    );

    expect(screen.queryByTestId("outlook-proposal-status")).toBeNull();
    expect(screen.getByRole("button", { name: "Reply" })).toHaveAttribute(
      "variant",
      "secondary",
    );
  });

  it("does not say no reply was opened when the draft's own button opened one", () => {
    show(
      proposed({
        status: "error",
        output: { status: "rejected", reason: "user_rejected" },
      }),
      "Draft body",
      (artifact) => markOutlookFormOpened(artifact.messageId, REPLY),
    );

    expect(screen.queryByTestId("outlook-proposal-status")).toBeNull();
  });

  it("says no reply was opened after the user denied it", () => {
    show(
      proposed({
        status: "error",
        output: { status: "rejected", reason: "user_rejected" },
      }),
    );

    expect(screen.getByTestId("outlook-proposal-status")).toHaveTextContent(
      "Denied. No reply was opened.",
    );
    expect(screen.getByRole("button", { name: "Reply" })).toBeEnabled();
  });

  it("says the reply opened once the server's call did", () => {
    show(
      proposed({
        status: "success",
        output: { result: { status: "applied" } },
      }),
    );

    expect(screen.getByTestId("outlook-proposal-status")).toHaveTextContent(
      "Reply opened in Outlook.",
    );
  });

  it("names another open email as why no reply opened", () => {
    show(
      proposed({
        status: "success",
        output: { result: { status: "unavailable", reason: "other_item" } },
      }),
    );

    expect(screen.getByTestId("outlook-proposal-status")).toHaveTextContent(
      "a different email is open now",
    );
  });

  it("follows the newest proposal once a change was asked for on the card", () => {
    const [draft, first, firstCall] = proposed({
      status: "error",
      output: { status: "change_requested" },
    });
    show([
      draft,
      first,
      firstCall,
      {
        content_type: "tool_use",
        tool_call_id: "call-again",
        tool_name: "propose_client_action",
        status: "success",
        input: { action: REPLY },
        output: { apply: { call_id: "call-again.apply" }, action: REPLY },
      },
    ]);

    expect(screen.getByTestId("outlook-proposal-status")).toHaveTextContent(
      "Waiting for your decision",
    );
  });

  it("says Stop ended the call before any reply opened", () => {
    show(
      proposed({
        status: "error",
        output: { status: "cancelled", reason: "aborted" },
      }),
    );

    expect(screen.getByTestId("outlook-proposal-status")).toHaveTextContent(
      "Stopped. No reply was opened.",
    );
  });

  it("adds no line and keeps the proposed button primary without a call of the server", () => {
    show([{ content_type: "text", text: "```erato-email\nDraft body\n```\n" }]);

    expect(screen.queryByTestId("outlook-proposal-status")).toBeNull();
    expect(screen.getByRole("button", { name: "Reply" })).toHaveAttribute(
      "variant",
      "primary",
    );
  });
});

describe("OutlookEratoEmailRenderer — read-reply gate tracks the reactive item signal", () => {
  // Stale-memo fix (ERMAIN-364): read actions gate on the REACTIVE isReadMode
  // (from the mail-item provider) plus the host-static isReplyFormHostSupported
  // (mocked true), never a live item read — so reply buttons appear in read
  // mode and are withheld when the provider reports compose / no item, instead
  // of caching a stale empty result.
  function primeMailItem(mailItem: unknown) {
    const artifact = makeArtifact();
    mockUseOutlookArtifact.mockReturnValue(artifact);
    mockUseOutlookMailItem.mockReturnValue({
      mailItem,
      itemIdentity: "item-a",
    });
    mockUseChatContext.mockReturnValue({
      messages: {
        [artifact.messageId]: { id: artifact.messageId, role: "assistant" },
      },
      messageOrder: [artifact.messageId],
    });
    server.decisions = {};
  }

  it("offers Reply / Reply All in read mode", () => {
    primeMailItem({ isComposeMode: false });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    expect(screen.getByRole("button", { name: "Reply" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reply All" }),
    ).toBeInTheDocument();
  });

  it("withholds the reply buttons when the provider reports compose mode", () => {
    primeMailItem({ isComposeMode: true });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reply All" })).toBeNull();
  });

  it("withholds the reply buttons when the provider reports no open item", () => {
    primeMailItem(null);
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
  });

  it("never offers an appointment action as a reply button (kind filter)", () => {
    // An appointment-only facet (outlook_schedule) stamps allowedClientActions
    // = ["outlook.create_appointment"]; the email renderer must not turn that
    // into a button whose click would open a REPLY form with the prose body.
    prime({
      artifact: makeArtifact({
        allowedClientActions: ["outlook.create_appointment"],
        proposedClientAction: "outlook.create_appointment",
      }),
      currentItemIdentity: "item-a",
    });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    // Only the Copy fallback remains.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });
});

describe("OutlookEratoEmailRenderer — copy", () => {
  it("delegates an HTML draft to the shared clipboard helper", async () => {
    prime({
      artifact: makeArtifact({ bodyFormat: "html" }),
      currentItemIdentity: null,
    });
    render(<OutlookEratoEmailRenderer content="<p>Hi</p>" isHtml={true} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(mockCopyEmailToClipboard).toHaveBeenCalledWith("<p>Hi</p>", true);
    expect(
      await screen.findByRole("button", { name: "Copied!" }),
    ).toBeInTheDocument();
  });

  it("passes isHtml=false for plain drafts", () => {
    prime({ artifact: makeArtifact(), currentItemIdentity: null });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(mockCopyEmailToClipboard).toHaveBeenCalledWith("Draft body", false);
  });
});

describe("OutlookEratoEmailRenderer — selection rewrite target", () => {
  const ORIGINAL = "Thanks for the quick reply.";

  function primeCompose(options: {
    rewriteTarget?: TestArtifact["rewriteTarget"];
    liveSelection: { data: string; sourceProperty: "body" | "subject" };
    subject?: string;
    isFreshCompletion?: boolean;
  }) {
    prime({
      artifact: makeArtifact({
        facetId: "outlook_rewrite_selection",
        allowedClientActions: [],
        rewriteTarget: options.rewriteTarget,
        ...(options.isFreshCompletion
          ? { isFreshCompletion: true, itemIdentity: "draft-a" }
          : {}),
      }),
      currentItemIdentity: "draft-a",
    });
    mockUseOutlookMailItem.mockReturnValue({
      mailItem: { isComposeMode: true },
      itemIdentity: "draft-a",
    });
    mockComposeSelection.mockReturnValue(options.liveSelection);

    const mailbox = installMockMailbox();
    const setSelectedDataAsync = vi.fn((_data, _options, callback) =>
      callback(createMockAsyncResult(undefined)),
    );
    const subjectSetAsync = vi.fn((_subject, callback) =>
      callback(createMockAsyncResult(undefined)),
    );
    mailbox.item = createMockMessageCompose({
      subject: {
        getAsync: vi.fn((callback) =>
          callback(
            createMockAsyncResult(options.subject ?? "Re: Budget draft v2"),
          ),
        ),
        setAsync: subjectSetAsync,
      },
      body: {
        getAsync: vi.fn(),
        getTypeAsync: vi.fn((callback) =>
          callback(createMockAsyncResult(Office.CoercionType.Text)),
        ),
        setSelectedDataAsync,
        prependAsync: vi.fn(),
      },
    });
    return { setSelectedDataAsync, subjectSetAsync };
  }

  afterEach(() => {
    uninstallMockMailbox();
    mockComposeSelection.mockReturnValue({ data: "", sourceProperty: "body" });
  });

  it("does not replace a selection that differs from the rewritten passage", () => {
    const { setSelectedDataAsync } = primeCompose({
      rewriteTarget: { selectedText: ORIGINAL, sourceProperty: "body" },
      liveSelection: { data: "Best regards, Dana", sourceProperty: "body" },
    });
    render(<OutlookEratoEmailRenderer content="Rewritten" isHtml={false} />);

    const replace = screen.getByRole("button", { name: "Replace Selection" });
    expect(replace).toBeDisabled();
    fireEvent.click(replace);

    expect(setSelectedDataAsync).not.toHaveBeenCalled();
    expect(
      screen.getByText(/The selection changed after your request/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();
  });

  it("guards a fresh completion the same way as a card from history", async () => {
    const { setSelectedDataAsync } = primeCompose({
      rewriteTarget: { selectedText: ORIGINAL, sourceProperty: "body" },
      liveSelection: { data: "Best regards, Dana", sourceProperty: "body" },
      isFreshCompletion: true,
    });
    render(<OutlookEratoEmailRenderer content="Rewritten" isHtml={false} />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Replace Selection" }),
      );
    });

    expect(setSelectedDataAsync).not.toHaveBeenCalled();
  });

  it("replaces when the original passage is selected, ignoring whitespace differences", async () => {
    const { setSelectedDataAsync } = primeCompose({
      rewriteTarget: { selectedText: ORIGINAL, sourceProperty: "body" },
      liveSelection: {
        data: "  Thanks for the\n quick reply. ",
        sourceProperty: "body",
      },
    });
    render(<OutlookEratoEmailRenderer content="Rewritten" isHtml={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Replace Selection" }));

    expect(
      await screen.findByRole("button", { name: "Done!" }),
    ).toBeInTheDocument();
    expect(setSelectedDataAsync).toHaveBeenCalledWith(
      "Rewritten",
      { coercionType: Office.CoercionType.Text },
      expect.any(Function),
    );
    expect(screen.queryByText(/The selection changed/)).toBeNull();
  });

  it("re-enables Replace once the original passage is selected again", () => {
    primeCompose({
      rewriteTarget: { selectedText: ORIGINAL, sourceProperty: "body" },
      liveSelection: { data: "Something else", sourceProperty: "body" },
    });
    const { rerender } = render(
      <OutlookEratoEmailRenderer content="Rewritten" isHtml={false} />,
    );
    expect(
      screen.getByRole("button", { name: "Replace Selection" }),
    ).toBeDisabled();

    mockComposeSelection.mockReturnValue({
      data: ORIGINAL,
      sourceProperty: "body",
    });
    rerender(<OutlookEratoEmailRenderer content="Rewritten" isHtml={false} />);

    expect(
      screen.getByRole("button", { name: "Replace Selection" }),
    ).toBeEnabled();
    expect(screen.queryByText(/The selection changed/)).toBeNull();
  });

  it("keeps Insert at Cursor for a body rewrite when nothing is selected", async () => {
    const { setSelectedDataAsync } = primeCompose({
      rewriteTarget: { selectedText: ORIGINAL, sourceProperty: "body" },
      liveSelection: { data: "", sourceProperty: "body" },
    });
    render(<OutlookEratoEmailRenderer content="Rewritten" isHtml={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Insert at Cursor" }));

    expect(
      await screen.findByRole("button", { name: "Done!" }),
    ).toBeInTheDocument();
    expect(setSelectedDataAsync).toHaveBeenCalledTimes(1);
  });

  it("shows an HTML draft formatted and inserts it as clean text into a plain-text body", async () => {
    const { setSelectedDataAsync } = primeCompose({
      liveSelection: { data: "", sourceProperty: "body" },
    });
    const { container } = render(
      <OutlookEratoEmailRenderer
        content={
          '<p>Hi <b>Anna</b>,</p><ul><li>one</li></ul><img src="https://x.example/p.gif">'
        }
        isHtml
      />,
    );

    expect(container.querySelector("b")).toHaveTextContent("Anna");
    expect(container.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Insert at Cursor" }));

    expect(
      await screen.findByRole("button", { name: "Done!" }),
    ).toBeInTheDocument();
    expect(setSelectedDataAsync).toHaveBeenCalledWith(
      "Hi Anna,\n\n- one",
      { coercionType: Office.CoercionType.Text },
      expect.any(Function),
    );
  });

  it("keeps Replace Selection for results that carry no rewrite target", async () => {
    const { setSelectedDataAsync } = primeCompose({
      liveSelection: { data: "Any passage", sourceProperty: "body" },
    });
    render(<OutlookEratoEmailRenderer content="Draft" isHtml={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Replace Selection" }));

    expect(
      await screen.findByRole("button", { name: "Done!" }),
    ).toBeInTheDocument();
    expect(setSelectedDataAsync).toHaveBeenCalledTimes(1);
  });

  it("writes a subject rewrite into the subject, never the body", async () => {
    const { setSelectedDataAsync, subjectSetAsync } = primeCompose({
      rewriteTarget: {
        selectedText: "Budget draft",
        sourceProperty: "subject",
      },
      liveSelection: { data: "Budget draft", sourceProperty: "subject" },
    });
    render(
      <OutlookEratoEmailRenderer content="Final budget plan" isHtml={false} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Replace Selection" }));

    expect(
      await screen.findByRole("button", { name: "Done!" }),
    ).toBeInTheDocument();
    expect(setSelectedDataAsync).not.toHaveBeenCalled();
    expect(subjectSetAsync).toHaveBeenCalledWith(
      "Re: Final budget plan v2",
      expect.any(Function),
    );
  });

  it("offers no write for a subject rewrite once the subject passage is no longer selected", () => {
    const { setSelectedDataAsync, subjectSetAsync } = primeCompose({
      rewriteTarget: {
        selectedText: "Budget draft",
        sourceProperty: "subject",
      },
      liveSelection: { data: "", sourceProperty: "body" },
    });
    render(
      <OutlookEratoEmailRenderer content="Final budget plan" isHtml={false} />,
    );

    const replace = screen.getByRole("button", { name: "Replace Selection" });
    expect(replace).toBeDisabled();
    fireEvent.click(replace);

    expect(setSelectedDataAsync).not.toHaveBeenCalled();
    expect(subjectSetAsync).not.toHaveBeenCalled();
    expect(
      screen.getByText(/The selection changed after your request/),
    ).toBeInTheDocument();
  });

  it("shows an error and writes nothing when the subject holds the passage more than once", async () => {
    const { setSelectedDataAsync, subjectSetAsync } = primeCompose({
      rewriteTarget: {
        selectedText: "Budget draft",
        sourceProperty: "subject",
      },
      liveSelection: { data: "Budget draft", sourceProperty: "subject" },
      subject: "Budget draft vs. Budget draft",
    });
    render(
      <OutlookEratoEmailRenderer content="Final budget plan" isHtml={false} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Replace Selection" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't replace the selected text in the subject",
    );
    expect(subjectSetAsync).not.toHaveBeenCalled();
    expect(setSelectedDataAsync).not.toHaveBeenCalled();
  });
});
