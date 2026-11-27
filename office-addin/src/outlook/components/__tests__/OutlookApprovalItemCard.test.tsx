import { i18n } from "@lingui/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../../test/mocks/outlook/mailbox";
import { createMockMessageRead } from "../../../test/mocks/outlook/readMail";
import { OutlookApprovalItemCard } from "../OutlookApprovalItemCard";

import type { ApprovalItemCardProps } from "@erato/frontend/library";
import type { ReactNode } from "react";

const DRAFT = "Thank you, the deletion was intended.";
const mockUseChatContext = vi.fn();
const open = vi.hoisted(() => ({ itemIdentity: null as string | null }));

vi.mock("@erato/frontend/library", async () =>
  (
    await import("../../../test/helpers/eratoLibraryMock")
  ).createEratoLibraryMock({ useChatContext: () => mockUseChatContext() }),
);

vi.mock("../../providers/OutlookMailItemProvider", () => ({
  useOutlookMailItem: () => ({ itemIdentity: open.itemIdentity }),
}));

beforeAll(() => {
  i18n.load("en", {});
  i18n.activate("en");
});

afterEach(() => {
  cleanup();
  uninstallMockMailbox();
  open.itemIdentity = null;
});

/** The generic card, drawing the host's note where it is given one. */
const renderDefault = (options?: { note?: ReactNode }) => (
  <div data-testid="generic-card">{options?.note}</div>
);

const props = (
  toolName: string,
  text: string,
  /** The email the server's call names as the one the draft was written for. */
  draftItem: string | null = null,
): ApprovalItemCardProps => {
  mockUseChatContext.mockReturnValue({
    messages: {
      answer: {
        id: "answer",
        role: "assistant",
        content: [{ content_type: "text", text }],
      },
    },
  });
  return {
    item: {
      approval_id: "call-propose.apply",
      tool_call_id: "call-propose.apply",
      tool_name: toolName,
      input: {
        proposal_call_id: "call-propose",
        action: "outlook.reply",
        item_identity: draftItem,
      },
      display: { title: "Open a reply in Outlook" },
      child: null,
      follows: { proposal_call_id: "call-propose", decide_on_screen: false },
    },
    serverId: "outlook",
    messageId: "answer",
    chatId: "chat-1",
    allowAlways: true,
    status: "pending",
    resolvedLabel: undefined,
    isBusy: false,
    onDecide: vi.fn(),
    renderDefault,
  } as unknown as ApprovalItemCardProps;
};

describe("OutlookApprovalItemCard", () => {
  const REPLY_ANSWER = "```erato-email\n" + DRAFT + "\n```\n";
  const openEmail = (itemIdentity: string | null) => {
    open.itemIdentity = itemIdentity;
    installMockMailbox().item = createMockMessageRead({
      from: { displayName: "Ada Sender", emailAddress: "ada@example.com" },
    });
  };

  it("names who the reply goes to and points at the draft above instead of repeating it", () => {
    openEmail("item-a");
    render(
      <OutlookApprovalItemCard
        {...props("open_reply", REPLY_ANSWER, "item-a")}
      />,
    );

    const card = screen.getByTestId("generic-card");
    expect(card).toHaveTextContent("To: Ada Sender <ada@example.com>");
    expect(card).toHaveTextContent("This opens the draft above as a reply.");
    expect(card).not.toHaveTextContent(DRAFT);
  });

  it("says another email is open instead of naming its sender as the recipient", () => {
    openEmail("item-b");
    render(
      <OutlookApprovalItemCard
        {...props("open_reply", REPLY_ANSWER, "item-a")}
      />,
    );

    const card = screen.getByTestId("generic-card");
    expect(card).toHaveTextContent(
      "This draft was written for a different email. Open that email again, or use Copy.",
    );
    expect(card).not.toHaveTextContent("Ada Sender");
    expect(card).not.toHaveTextContent(
      "This opens the draft above as a reply.",
    );
  });

  it("names no recipients when the email the draft was written for is unknown", () => {
    openEmail("item-a");
    render(<OutlookApprovalItemCard {...props("open_reply", REPLY_ANSWER)} />);

    const card = screen.getByTestId("generic-card");
    expect(card).not.toHaveTextContent("To:");
    expect(card).not.toHaveTextContent("Ada Sender");
    expect(card).toHaveTextContent("This opens the draft above as a reply.");
  });

  it("names no recipients when the open email is unknown", () => {
    openEmail(null);
    render(
      <OutlookApprovalItemCard
        {...props("open_reply", REPLY_ANSWER, "item-a")}
      />,
    );

    const card = screen.getByTestId("generic-card");
    expect(card).not.toHaveTextContent("Ada Sender");
    expect(card).toHaveTextContent("This opens the draft above as a reply.");
  });

  it("points at the appointment above", () => {
    render(
      <OutlookApprovalItemCard
        {...props(
          "open_appointment",
          '```erato-appointment\n{"subject":"Review","start":"2026-11-26T10:00:00","end":"2026-11-26T11:00:00"}\n```\n',
        )}
      />,
    );

    expect(screen.getByTestId("generic-card")).toHaveTextContent(
      "This opens the appointment above in Outlook.",
    );
  });

  it("adds no note when the answer holds no draft to point at", () => {
    render(<OutlookApprovalItemCard {...props("open_reply", "No draft.")} />);

    expect(screen.getByTestId("generic-card")).toBeEmptyDOMElement();
  });
});
