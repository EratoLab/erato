import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { OutlookEratoEmailRenderer } from "../OutlookEratoEmailRenderer";

// The renderer's collaborators are mocked at the seams the tests steer:
// the artifact + chat snapshot (what AddinChat stamps), the current Outlook
// item identity, the persisted decisions, and the Office.js reply module —
// the tests only assert WHETHER the reply form is reached, never how.
const mockUseOutlookMailItem = vi.fn();
const mockUseOutlookArtifact = vi.fn();
const mockUseChatContext = vi.fn();
const mockUsePersistedState = vi.fn();
const mockOpenReplyForm = vi.fn();
const mockGetReadModeRecipientSummary = vi.fn();
const mockCopyEmailToClipboard = vi.fn();

vi.mock("@erato/frontend/library", () => ({
  // Mirrors the real card's lifecycle contract: decision buttons only while
  // pending, a resolved row afterwards.
  ActionConfirmationCard: (props: {
    onAllowOnce: () => void;
    onAlwaysAllow: () => void;
    onDeny: () => void;
    status?: string;
    resolvedLabel?: string;
    isBusy?: boolean;
  }) => (
    <div
      data-testid="confirmation-card"
      data-status={props.status ?? "pending"}
      data-busy={props.isBusy ? "true" : "false"}
    >
      {(props.status ?? "pending") === "pending" ? (
        <>
          <button
            type="button"
            disabled={props.isBusy}
            onClick={props.onAllowOnce}
          >
            allow-once
          </button>
          <button
            type="button"
            disabled={props.isBusy}
            onClick={props.onAlwaysAllow}
          >
            always-allow
          </button>
          <button type="button" disabled={props.isBusy} onClick={props.onDeny}>
            deny
          </button>
        </>
      ) : (
        <span data-testid="resolved-label">{props.resolvedLabel}</span>
      )}
    </div>
  ),
  sanitizeHtmlPreview: (html: string) => html,
  copyEmailToClipboard: (...args: unknown[]) =>
    Promise.resolve(mockCopyEmailToClipboard(...args)),
  htmlToPlainText: (html: string) =>
    new DOMParser().parseFromString(html, "text/html").body.textContent ?? "",
  useChatContext: () => mockUseChatContext(),
  useOutlookArtifact: () => mockUseOutlookArtifact(),
  usePersistedState: () => mockUsePersistedState(),
}));

vi.mock("../../providers/OutlookMailItemProvider", () => ({
  useOutlookMailItem: () => mockUseOutlookMailItem(),
}));

vi.mock("../../hooks/useOutlookComposeSelection", () => ({
  useOutlookComposeSelection: () => ({ data: "", sourceProperty: "body" }),
}));

vi.mock("../../utils/outlookReadReply", () => ({
  ReplyBodyTooLargeError: class ReplyBodyTooLargeError extends Error {},
  isReplyFormHostSupported: () => true,
  getReadModeRecipientSummary: () => mockGetReadModeRecipientSummary(),
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
  clientActionPresentation: string;
  isFreshCompletion?: boolean;
  itemIdentity?: string;
  proposedClientAction?: string;
}

// Unique per test: the renderer's once-per-message auto-prompt slot is
// module-level state that intentionally survives remounts (and thus tests).
let nextMessageId = 0;

function makeArtifact(overrides: Partial<TestArtifact> = {}): TestArtifact {
  nextMessageId += 1;
  return {
    facetId: FACET,
    bodyFormat: "text",
    renderMode: "body",
    messageId: `msg-${nextMessageId}`,
    allowedClientActions: ["outlook.reply", "outlook.reply_all"],
    clientActionPresentation: "render_buttons",
    ...overrides,
  };
}

function prime(options: {
  artifact: TestArtifact;
  currentItemIdentity: string | null;
  decisions?: Record<string, string>;
}) {
  mockUseOutlookArtifact.mockReturnValue(options.artifact);
  mockUseOutlookMailItem.mockReturnValue({
    mailItem: { isComposeMode: false },
    itemIdentity: options.currentItemIdentity,
  });
  mockUseChatContext.mockReturnValue({
    messages: {
      [options.artifact.messageId]: {
        id: options.artifact.messageId,
        role: "assistant",
      },
    },
    messageOrder: [options.artifact.messageId],
  });
  mockUsePersistedState.mockReturnValue([options.decisions ?? {}, vi.fn()]);
  mockGetReadModeRecipientSummary.mockReturnValue({
    sender: "Alice Sender",
    recipients: ["Bob", "Carol"],
  });
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
      decisions: { [`${FACET}/${REPLY}`]: "always" },
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
  // history draft: buttons stay usable, clicks are re-guarded by the
  // confirmation card's item snapshot, the stale-item error never fires
  // (it requires a KNOWN mismatching identity), and auto-prompt is
  // impossible.

  it("keeps the reply buttons usable with no stale-item error", () => {
    prime({ artifact: makeArtifact(), currentItemIdentity: "item-a" });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("confirmation-card")).toBeInTheDocument();
  });

  it("executes a click directly under a granted action, like any history draft", async () => {
    prime({
      artifact: makeArtifact(),
      currentItemIdentity: "item-a",
      decisions: { [`${FACET}/${REPLY}`]: "always" },
    });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    });

    expect(mockOpenReplyForm).toHaveBeenCalledWith(REPLY, "Draft body", false);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never auto-prompts, even under auto_prompt with a granted proposal", () => {
    prime({
      artifact: makeArtifact({
        clientActionPresentation: "auto_prompt",
        proposedClientAction: REPLY,
      }),
      currentItemIdentity: "item-a",
      decisions: { [`${FACET}/${REPLY}`]: "always" },
    });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    expect(mockOpenReplyForm).not.toHaveBeenCalled();
    expect(screen.queryByTestId("confirmation-card")).not.toBeInTheDocument();
  });
});

describe("OutlookEratoEmailRenderer — confirmation-card item snapshot", () => {
  it("aborts allow-once when the email changed while the card was open", async () => {
    // History draft: no artifact identity, so only the card-open snapshot
    // can catch the switch.
    prime({ artifact: makeArtifact(), currentItemIdentity: "item-a" });
    const view = render(
      <OutlookEratoEmailRenderer content="Draft body" isHtml={false} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(screen.getByTestId("confirmation-card")).toBeInTheDocument();

    mockUseOutlookMailItem.mockReturnValue({
      mailItem: { isComposeMode: false },
      itemIdentity: "item-b",
    });
    view.rerender(
      <OutlookEratoEmailRenderer content="Draft body" isHtml={false} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "allow-once" }));
    });

    expect(mockOpenReplyForm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "written for a different email",
    );
    // The card records the failed outcome instead of vanishing.
    expect(screen.getByTestId("confirmation-card")).toHaveAttribute(
      "data-status",
      "dismissed",
    );
  });

  it("aborts always-allow the same way (the persisted grant must not bypass the snapshot)", async () => {
    prime({ artifact: makeArtifact(), currentItemIdentity: "item-a" });
    const view = render(
      <OutlookEratoEmailRenderer content="Draft body" isHtml={false} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    mockUseOutlookMailItem.mockReturnValue({
      mailItem: { isComposeMode: false },
      itemIdentity: "item-b",
    });
    view.rerender(
      <OutlookEratoEmailRenderer content="Draft body" isHtml={false} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "always-allow" }));
    });

    expect(mockOpenReplyForm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "written for a different email",
    );
  });

  it("executes a confirmed action when the item is unchanged", async () => {
    prime({ artifact: makeArtifact(), currentItemIdentity: "item-a" });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "allow-once" }));
    });

    expect(mockOpenReplyForm).toHaveBeenCalledWith(REPLY, "Draft body", false);
  });
});

describe("OutlookEratoEmailRenderer — auto-prompt one-shot", () => {
  function makeAutoPromptArtifact(): TestArtifact {
    return makeArtifact({
      isFreshCompletion: true,
      itemIdentity: "item-a",
      clientActionPresentation: "auto_prompt",
      proposedClientAction: REPLY,
    });
  }

  it("auto-surfaces the confirmation card for a fresh matching proposal", () => {
    prime({
      artifact: makeAutoPromptArtifact(),
      currentItemIdentity: "item-a",
    });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    expect(screen.getByTestId("confirmation-card")).toBeInTheDocument();
  });

  it("does not resurrect the auto-prompt when a denied action is later granted", () => {
    prime({
      artifact: makeAutoPromptArtifact(),
      currentItemIdentity: "item-a",
      decisions: { [`${FACET}/${REPLY}`]: "never" },
    });
    const view = render(
      <OutlookEratoEmailRenderer content="Draft body" isHtml={false} />,
    );
    expect(screen.queryByTestId("confirmation-card")).not.toBeInTheDocument();

    // The user flips the setting AFTER the completion has passed. The
    // once-per-message slot was consumed on the first fresh render, so the
    // grant must not pop a reply form now.
    mockUsePersistedState.mockReturnValue([
      { [`${FACET}/${REPLY}`]: "always" },
      vi.fn(),
    ]);
    view.rerender(
      <OutlookEratoEmailRenderer content="Draft body" isHtml={false} />,
    );

    expect(mockOpenReplyForm).not.toHaveBeenCalled();
    expect(screen.queryByTestId("confirmation-card")).not.toBeInTheDocument();
  });

  it("does not auto-open for a message that is no longer the latest assistant message", () => {
    const artifact = makeAutoPromptArtifact();
    prime({
      artifact,
      currentItemIdentity: "item-a",
      decisions: { [`${FACET}/${REPLY}`]: "always" },
    });
    mockUseChatContext.mockReturnValue({
      messages: {
        [artifact.messageId]: { id: artifact.messageId, role: "assistant" },
        newer: { id: "newer", role: "assistant" },
      },
      messageOrder: [artifact.messageId, "newer"],
    });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    expect(mockOpenReplyForm).not.toHaveBeenCalled();
    expect(screen.queryByTestId("confirmation-card")).not.toBeInTheDocument();
  });

  it("does not auto-open when the user switched emails before the prompt could fire", () => {
    prime({
      artifact: makeAutoPromptArtifact(),
      currentItemIdentity: "item-b",
      decisions: { [`${FACET}/${REPLY}`]: "always" },
    });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    expect(mockOpenReplyForm).not.toHaveBeenCalled();
    expect(screen.queryByTestId("confirmation-card")).not.toBeInTheDocument();
  });
});

describe("OutlookEratoEmailRenderer — resolved confirmation card", () => {
  it("keeps the card as a confirmed record after allow-once and re-enables the proposal buttons", async () => {
    prime({ artifact: makeArtifact(), currentItemIdentity: "item-a" });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(screen.getByRole("button", { name: "Reply" })).toBeDisabled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "allow-once" }));
    });

    expect(mockOpenReplyForm).toHaveBeenCalledWith(REPLY, "Draft body", false);
    expect(screen.getByTestId("confirmation-card")).toHaveAttribute(
      "data-status",
      "confirmed",
    );
    expect(screen.getByTestId("resolved-label")).toHaveTextContent(
      "Reply form opened",
    );
    expect(screen.getByRole("button", { name: "Reply" })).toBeEnabled();
  });

  it("labels a confirmed reply-all with its own outcome", async () => {
    prime({ artifact: makeArtifact(), currentItemIdentity: "item-a" });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Reply All" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "allow-once" }));
    });

    expect(screen.getByTestId("resolved-label")).toHaveTextContent(
      "Reply All form opened",
    );
  });

  it("records a deny as dismissed instead of unmounting the card", () => {
    prime({ artifact: makeArtifact(), currentItemIdentity: "item-a" });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    fireEvent.click(screen.getByRole("button", { name: "deny" }));

    expect(mockOpenReplyForm).not.toHaveBeenCalled();
    expect(screen.getByTestId("confirmation-card")).toHaveAttribute(
      "data-status",
      "dismissed",
    );
    expect(screen.getByRole("button", { name: "Reply" })).toBeEnabled();
  });

  it("resolves the card as not opened when the reply form fails", async () => {
    mockOpenReplyForm.mockRejectedValueOnce(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    prime({ artifact: makeArtifact(), currentItemIdentity: "item-a" });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "allow-once" }));
    });

    expect(screen.getByTestId("confirmation-card")).toHaveAttribute(
      "data-status",
      "dismissed",
    );
    expect(screen.getByTestId("resolved-label")).toHaveTextContent(
      "could not be opened",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to open the reply form",
    );
    warn.mockRestore();
  });

  it("disables the card buttons while the reply form is opening", async () => {
    let resolveOpen!: () => void;
    mockOpenReplyForm.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveOpen = resolve;
        }),
    );
    prime({ artifact: makeArtifact(), currentItemIdentity: "item-a" });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    fireEvent.click(screen.getByRole("button", { name: "allow-once" }));

    expect(screen.getByTestId("confirmation-card")).toHaveAttribute(
      "data-busy",
      "true",
    );

    await act(async () => {
      resolveOpen();
    });

    expect(screen.getByTestId("confirmation-card")).toHaveAttribute(
      "data-status",
      "confirmed",
    );
  });

  it("replaces a resolved card with a fresh pending one on the next request", () => {
    prime({ artifact: makeArtifact(), currentItemIdentity: "item-a" });
    render(<OutlookEratoEmailRenderer content="Draft body" isHtml={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    fireEvent.click(screen.getByRole("button", { name: "deny" }));
    expect(screen.getByTestId("confirmation-card")).toHaveAttribute(
      "data-status",
      "dismissed",
    );

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(screen.getByTestId("confirmation-card")).toHaveAttribute(
      "data-status",
      "pending",
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
    mockUsePersistedState.mockReturnValue([{}, vi.fn()]);
    mockGetReadModeRecipientSummary.mockReturnValue({
      sender: "Alice Sender",
      recipients: ["Bob"],
    });
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
