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
const messages = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@erato/frontend/library", () => ({
  useConversationMessage: (messageId?: string) =>
    messageId ? messages.current[messageId] : undefined,
}));

beforeAll(() => {
  i18n.load("en", {});
  i18n.activate("en");
});

afterEach(() => {
  cleanup();
  uninstallMockMailbox();
});

/** The generic card, drawing the host's note where it is given one. */
const renderDefault = (options?: { note?: ReactNode }) => (
  <div data-testid="generic-card">{options?.note}</div>
);

const props = (toolName: string, text: string): ApprovalItemCardProps => {
  messages.current = {
    answer: {
      id: "answer",
      role: "assistant",
      content: [{ content_type: "text", text }],
    },
  };
  return {
    item: {
      approval_id: "call-propose.apply",
      tool_call_id: "call-propose.apply",
      tool_name: toolName,
      input: {},
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
  it("names who the reply goes to and points at the draft above instead of repeating it", () => {
    installMockMailbox().item = createMockMessageRead({
      from: { displayName: "Ada Sender", emailAddress: "ada@example.com" },
    });
    render(
      <OutlookApprovalItemCard
        {...props("open_reply", "```erato-email\n" + DRAFT + "\n```\n")}
      />,
    );

    const card = screen.getByTestId("generic-card");
    expect(card).toHaveTextContent("To: Ada Sender <ada@example.com>");
    expect(card).toHaveTextContent("This opens the draft above as a reply.");
    expect(card).not.toHaveTextContent(DRAFT);
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
