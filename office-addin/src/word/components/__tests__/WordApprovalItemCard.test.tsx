import { i18n } from "@lingui/core";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WordApprovalItemCard } from "../WordApprovalItemCard";

import type { ApprovalItemCardProps } from "@erato/frontend/library";

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock({
    useConversationMessage: () => ({
      id: "message-A",
      role: "assistant",
      content: [],
      hostArtifact: { facetId: "word_document_authoring", messageId: "m" },
    }),
  });
});

const props = (
  overrides: Partial<ApprovalItemCardProps["item"]> = {},
  serverId = "word",
): ApprovalItemCardProps => ({
  item: {
    approval_id: "submit-A.apply",
    tool_call_id: "submit-A.apply",
    tool_name: "apply_document_plan",
    input: {},
    display: {
      title: "Change “Vertrag.docx”",
      description: "Change 1 paragraph",
    },
    chained: { submission_call_id: "submit-A", decide_on_screen: false },
    ...overrides,
  } as ApprovalItemCardProps["item"],
  serverId,
  messageId: "message-A",
  chatId: "chat-A",
  allowAlways: true,
  status: "pending",
  resolvedLabel: undefined,
  isBusy: false,
  onDecide: vi.fn(),
  renderDefault: vi.fn((options?: { note?: unknown }) => (
    <div data-testid="generic-card">{String(options?.note ?? "")}</div>
  )),
});

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});

describe("Word's card in the decision place", () => {
  it("after a reload shows the server's title and summary with the read-again line", () => {
    const card = props();
    render(<WordApprovalItemCard {...card} />);
    expect(card.renderDefault).toHaveBeenCalledWith({
      note: "The document has to be read again before this change can be made.",
    });
    expect(screen.getByTestId("generic-card")).toHaveTextContent("read again");
  });

  it("leaves other tools and hosts to the generic card", () => {
    const other = props({ tool_name: "open_reply" }, "outlook");
    render(<WordApprovalItemCard {...other} />);
    expect(other.renderDefault).toHaveBeenCalledWith();
  });
});
