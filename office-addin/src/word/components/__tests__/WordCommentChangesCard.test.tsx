import { i18n } from "@lingui/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messages as frontendMessages } from "../../../../../frontend/src/locales/en/messages.po";
import { TestTheme } from "../../../test/helpers/TestTheme";
import {
  installWordSelectionHost,
  uninstallWordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import { WordWriteProvider } from "../../providers/WordWriteProvider";
import { createWordApplyCommentsExecutor } from "../../utils/wordApplyCommentCall";
import { WORD_CLIENT_ACTIONS } from "../../utils/wordClientActions";
import { wordCommentReceipts } from "../../utils/wordCommentCard";
import { resetWordCommentSession } from "../../utils/wordCommentPolicy";
import { forgetWordCommentRefs } from "../../utils/wordCommentRefs";
import {
  createWordCommentSubmissionExecutor,
  forgetWordCommentDrafts,
} from "../../utils/wordCommentSubmission";
import { WORD_PREFERENCES_KEY } from "../../wordPreferences";
import { WordCommentChangesCard } from "../WordCommentChangesCard";
import { WordHostCardRenderer } from "../WordHostCardRenderer";

import type {
  MockSelectionDocument,
  WordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import type { WordClientAction } from "../../utils/wordClientActions";
import type { WordCommentRefEntry } from "../../utils/wordCommentRefs";
import type { WordCommentsCapture } from "../../utils/wordCommentSend";
import type { WordCardDecision } from "../WordDecisionChoices";
import type * as EratoLibrary from "@erato/frontend/library";

const mockUseHostArtifact = vi.fn();
const mockUseChatContext = vi.fn();
const mockProfile = vi.fn();
/** What the decision place sent the server, in order. */
const decided: string[] = [];

vi.mock("@erato/frontend/library", async (importOriginal) => ({
  ...(await importOriginal<typeof EratoLibrary>()),
  ActionConfirmationCard: (props: {
    allowOnceLabel?: string;
    onAllowOnce?: () => void;
    onAlwaysAllow?: () => void;
    onDeny: () => void;
    alwaysAllowDisabledReason?: string;
  }) => (
    <div data-testid="confirmation-card">
      {props.onAllowOnce && (
        <button type="button" onClick={props.onAllowOnce}>
          {props.allowOnceLabel}
        </button>
      )}
      {props.onAlwaysAllow && (
        <button
          type="button"
          disabled={!!props.alwaysAllowDisabledReason}
          onClick={props.onAlwaysAllow}
        >
          Always allow
        </button>
      )}
      <button type="button" onClick={props.onDeny}>
        Cancel
      </button>
      <span>{props.alwaysAllowDisabledReason}</span>
    </div>
  ),
  useChatContext: () => mockUseChatContext(),
  ...(await import("../../../test/helpers/eratoLibraryMock")).chatHooksFrom(
    () => mockUseChatContext(),
  ),
  useHostArtifact: () => mockUseHostArtifact(),
  usePersistedState: (_key: string, fallback: unknown) => [fallback, vi.fn()],
  useProfile: () => mockProfile(),
}));

const IDENTITY = "https://contoso.sharepoint.com/report.docx";
const DOC: MockSelectionDocument = {
  body: [
    "H1 Comment card heading",
    {
      runs: [
        "T1P Payment within ",
        { text: "net 30 days", commented: "T1" },
        { comment: "T1" },
        " of the invoice.",
      ],
    },
    "AP1 Plain paragraph alpha beta gamma.",
  ],
  commentMeta: {
    T1: {
      author: "Maya Krüger",
      email: "maya@contoso.test",
      content: "T1 root",
      replies: [
        {
          author: "Jonas Weber",
          email: "jonas@contoso.test",
          content: "T1 reply",
        },
      ],
    },
  },
};

let host: WordSelectionHost;
let nextMessage = 0;

function threads(): Map<string, WordCommentRefEntry> {
  const [t1] = host.commentStates();
  return new Map([
    [
      "t7k",
      {
        ref: "t7k",
        commentId: t1.id,
        matchedBy: "id",
        readOnly: null,
        fingerprint: {
          id: t1.id,
          author: t1.author,
          email: t1.email,
          created: null,
          content: t1.content,
          resolved: t1.resolved,
          replyIds: t1.replies.map((r) => r.id),
          replies: t1.replies.map((r) => ({ ...r, created: null })),
          anchor: { para: 2, quote: "net 30 days" },
        },
      },
    ],
  ]);
}

async function submit(changes: unknown[], toolCallId: string) {
  const capture: WordCommentsCapture = {
    identity: IDENTITY,
    ordinalMap: new Map(),
    paragraphsSent: 0,
    renderedOrdinals: new Set(),
    partialOrdinal: null,
  };
  const result = await createWordCommentSubmissionExecutor({
    session: {
      submissionScope: () => ({
        token: toolCallId,
        identity: IDENTITY,
        capture,
        threads: threads(),
        people: { principalEmail: "testuser@contoso.test" },
      }),
    },
  })({ changes }, { toolCallId, messageId: "m", chatId: "c" });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return capture;
}

/** The card in the chat's decision place; approving runs the server's call that writes. */
function decisionFor(
  messageId: string,
  draftId: string,
  allowAlways: boolean,
): WordCardDecision {
  const apply = createWordApplyCommentsExecutor({ readEnabled: () => false });
  return {
    allowAlways,
    decideOnScreen: false,
    status: "pending",
    resolvedLabel: undefined,
    isBusy: false,
    onDecide: (choice, extras) => {
      decided.push(choice);
      if (choice === "approve" || choice === "approve_always")
        void apply(
          {
            submission_call_id: draftId,
            draft_id: draftId,
            confirmation: extras?.clientConfirmation ?? null,
          },
          { toolCallId: `${draftId}.apply`, messageId, chatId: "chat-1" },
        );
    },
  };
}

function renderCard(options: {
  action: string;
  draftId: string;
  capture: WordCommentsCapture | null;
  /** The card in the answer instead of the one in the decision place. */
  inAnswer?: boolean;
  /** The server lets the user choose Always for comment changes. */
  allowAlways?: boolean;
  /** The accepted submission of this message, when it is not the draft the fence names. */
  submitted?: string;
}) {
  nextMessage += 1;
  const messageId = `assistant-${nextMessage}`;
  const language = {
    "word.add_comments": "erato-word-comments-add",
    "word.respond_to_comments": "erato-word-comments-respond",
    "word.modify_comments": "erato-word-comments-modify",
  }[options.action]!;
  mockUseHostArtifact.mockReturnValue({
    facetId: "word_selection",
    renderMode: "suggestions",
    messageId,
    allowedClientActions: [options.action],
    isFreshCompletion: true,
    itemIdentity: IDENTITY,
    submittedCard: {
      toolCallId: options.submitted ?? options.draftId,
      content: options.submitted ?? options.draftId,
      language,
    },
  });
  mockUseChatContext.mockReturnValue({
    messages: {
      user: {
        id: "user",
        role: "user",
        content: [{ content_type: "text", text: "Comment on it." }],
      },
      [messageId]: {
        id: messageId,
        role: "assistant",
        previous_message_id: "user",
        content: [],
      },
    },
    messageOrder: ["user", messageId],
    currentChatId: "chat-1",
  });
  const captures = new Map(
    options.capture ? [[messageId, options.capture]] : [],
  );
  const decision = decisionFor(
    messageId,
    options.draftId,
    options.allowAlways ?? true,
  );
  const tree = (identity: string) => (
    <WordWriteProvider
      documentIdentity={identity}
      capturesByAssistantMessageId={captures}
    >
      {options.inAnswer ? (
        <WordHostCardRenderer language={language} content={options.draftId} />
      ) : (
        <WordCommentChangesCard
          entry={WORD_CLIENT_ACTIONS.get(options.action as WordClientAction)!}
          content={options.draftId}
          decision={decision}
        />
      )}
    </WordWriteProvider>
  );
  const view = render(tree(IDENTITY), { wrapper: TestTheme });
  return {
    ...view,
    /** The user switches Word to another document. */
    openDocument: (identity: string) => view.rerender(tree(identity)),
  };
}

const rows = () => screen.getAllByTestId("word-comments-row");

describe("WordCommentChangesCard", () => {
  beforeEach(() => {
    i18n.load("en", frontendMessages);
    i18n.activate("en");
    host = installWordSelectionHost(DOC, { host: "pc" });
    mockProfile.mockReturnValue({
      profile: { name: "Max Token", email: "testuser@contoso.test" },
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    uninstallWordSelectionHost();
    forgetWordCommentDrafts();
    forgetWordCommentRefs();
    resetWordCommentSession();
    delete window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS;
    localStorage.clear();
    decided.length = 0;
  });

  it("shows each new comment's exact text and author, counts the ticked rows and posts only those", async () => {
    const capture = await submit(
      [
        { op: "add", anchor: { para: 3, quote: "alpha" }, text: "First." },
        { op: "add", anchor: { para: 3, quote: "gamma" }, text: "Second." },
      ],
      "call-add",
    );
    renderCard({ action: "word.add_comments", draftId: "call-add", capture });
    expect(within(rows()[0]).getByText("Erato AI: First.")).toBeInTheDocument();
    expect(
      within(rows()[0]).getByText(
        'Word will show this as written by you (Max Token). It starts with "Erato AI:".',
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(rows()[1]).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 comment" }));
    await waitFor(() =>
      expect(
        within(rows()[0]).getByTestId("word-comments-row-status"),
      ).toHaveTextContent("Done"),
    );
    expect(
      within(rows()[1]).getByTestId("word-comments-row-status"),
    ).toHaveTextContent("Not written — you left it out");
    expect(host.commentStates().map((c) => c.content)).toEqual([
      "T1 root",
      "Erato AI: First.",
    ]);
    expect(wordCommentReceipts().at(-1)).toMatchObject({
      draftId: "call-add",
      consent: "approved",
      consentKind: "click",
      rows: [
        { i: 0, op: "add", status: "applied" },
        { i: 1, op: "add", status: "refused", code: "DESELECTED" },
      ],
    });

    fireEvent.click(screen.getByTestId("word-comments-revert"));
    fireEvent.click(screen.getAllByRole("button", { name: "Revert" }).at(-1)!);
    await screen.findByText("Reverted 1 of 1; Revert is used up.");
    expect(host.commentStates().map((c) => c.content)).toEqual(["T1 root"]);
    expect(screen.queryByTestId("word-comments-revert")).toBeNull();
  });

  it("names the thread, its author, its replies and that a delete cannot be undone", async () => {
    const capture = await submit([{ op: "delete", target: "t7k" }], "call-del");
    renderCard({
      action: "word.modify_comments",
      draftId: "call-del",
      capture,
    });
    const row = within(rows()[0]);
    expect(
      row.getByText('Maya Krüger: "T1 root" · open · 1 reply'),
    ).toBeInTheDocument();
    expect(
      row.getByText("Also deletes 1 reply by Jonas Weber."),
    ).toBeInTheDocument();
    expect(row.getByText("Erato cannot undo this.")).toBeInTheDocument();
    expect(row.getByText(/Resolving it keeps their words/)).toBeInTheDocument();
  });

  it("offers no Always where the server asks every time, and Cancel declines with nothing written", async () => {
    const capture = await submit(
      [{ op: "resolve", thread: "t7k" }],
      "call-res",
    );
    renderCard({
      action: "word.respond_to_comments",
      draftId: "call-res",
      capture,
      allowAlways: false,
    });
    expect(screen.getByRole("button", { name: "Always allow" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(decided).toEqual(["reject"]);
    expect(host.commentStates()[0].resolved).toBe(false);
  });

  it("offers no Add in the answer, where nothing is decided", async () => {
    const capture = await submit(
      [{ op: "add", anchor: { para: 3, quote: "alpha" }, text: "x" }],
      "call-answer",
    );
    renderCard({
      action: "word.add_comments",
      draftId: "call-answer",
      capture,
      inAnswer: true,
    });
    expect(screen.queryByRole("button", { name: "Add 1 comment" })).toBeNull();
    expect(within(rows()[0]).getByRole("checkbox")).toBeDisabled();
    expect(host.commentStates()).toHaveLength(1);
  });

  it("does not honour Always for adds when the request carried other people's comments", async () => {
    const capture = await submit(
      [{ op: "add", anchor: { para: 3, quote: "alpha" }, text: "x" }],
      "call-taint",
    );
    renderCard({
      action: "word.add_comments",
      draftId: "call-taint",
      capture: { ...capture, commentTaint: true },
    });
    expect(await screen.findByTestId("confirmation-card")).toHaveTextContent(
      "This request included comments by other people, so Erato asks each time.",
    );
    expect(
      screen.getByText("This request included comments by other people."),
    ).toBeInTheDocument();
    expect(host.commentStates()).toHaveLength(1);
  });

  it("does not honour Always for a delete when the request carried other people's comments", async () => {
    const capture = await submit(
      [{ op: "delete", target: "t7k" }],
      "call-taint-del",
    );
    renderCard({
      action: "word.modify_comments",
      draftId: "call-taint-del",
      capture: { ...capture, commentTaint: true },
    });
    expect(await screen.findByTestId("confirmation-card")).toHaveTextContent(
      "This request included comments by other people, so Erato asks each time.",
    );
    expect(
      screen.getByText("This request included comments by other people."),
    ).toBeInTheDocument();
    expect(host.commentStates().map((c) => c.content)).toEqual(["T1 root"]);
  });

  it("blocks Always for adds without a label", async () => {
    window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS = { comment_label: "" };
    const capture = await submit(
      [{ op: "add", anchor: { para: 3, quote: "alpha" }, text: "x" }],
      "call-nolabel",
    );
    renderCard({
      action: "word.add_comments",
      draftId: "call-nolabel",
      capture,
    });
    expect(await screen.findByTestId("confirmation-card")).toHaveTextContent(
      "Comments carry no AI label here, so Erato asks each time.",
    );
  });

  it("offers Copy comment and Show passage only where the deployment set copy", async () => {
    window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS = {
      comment_writes: { add: "copy" },
    };
    const capture = await submit(
      [{ op: "add", anchor: { para: 3, quote: "alpha" }, text: "x" }],
      "call-copy",
    );
    renderCard({ action: "word.add_comments", draftId: "call-copy", capture });
    expect(screen.queryByRole("button", { name: "Add 1 comment" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy comment" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show passage" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Copy each comment and post it in Word yourself/),
    ).toBeInTheDocument();
  });

  it("says before consent which rows post under the user's name in AI-author mode", async () => {
    uninstallWordSelectionHost();
    host = installWordSelectionHost(DOC, { host: "web" });
    localStorage.setItem(
      WORD_PREFERENCES_KEY,
      JSON.stringify({ commentAuthor: "assistant" }),
    );
    const capture = await submit(
      [{ op: "add", anchor: { para: 3, quote: "alpha" }, text: "x" }],
      "call-web",
    );
    renderCard({ action: "word.add_comments", draftId: "call-web", capture });
    expect(
      screen.getByText(/not available in Word for the web yet/),
    ).toBeInTheDocument();
  });

  it("cannot write a proposal from an earlier pane session", () => {
    renderCard({
      action: "word.add_comments",
      draftId: "gone",
      capture: null,
      inAnswer: true,
    });
    expect(
      screen.getByText(/belong to an earlier session of this pane/),
    ).toBeInTheDocument();
  });

  it("offers no retry for another open document and keeps the approval it follows", async () => {
    uninstallWordSelectionHost();
    host = installWordSelectionHost(DOC, {
      host: "pc",
      insertCommentError: () => "GeneralException",
    });
    const capture = await submit(
      [{ op: "add", anchor: { para: 3, quote: "alpha" }, text: "x" }],
      "call-retry",
    );
    const view = renderCard({
      action: "word.add_comments",
      draftId: "call-retry",
      capture,
    });
    fireEvent.click(screen.getByRole("button", { name: "Add 1 comment" }));
    const retry = await screen.findByRole("button", {
      name: "Try the rows Word did not take again",
    });
    expect(retry).toBeEnabled();
    const approved = wordCommentReceipts().at(-1);
    expect(approved).toMatchObject({ consent: "approved" });
    view.openDocument("another-document");
    expect(
      screen.getByRole("button", {
        name: "Try the rows Word did not take again",
      }),
    ).toBeDisabled();
    expect(wordCommentReceipts().at(-1)).toEqual(approved);
  });

  it("ignores a fence naming a draft this message did not submit", async () => {
    const capture = await submit(
      [{ op: "add", anchor: { para: 3, quote: "alpha" }, text: "old" }],
      "call-old",
    );
    renderCard({
      action: "word.add_comments",
      draftId: "call-old",
      submitted: "call-new",
      capture,
      inAnswer: true,
    });
    expect(screen.queryByTestId("word-comments-card")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add/ })).toBeNull();
  });
});
