import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { messages as deMessages } from "@/locales/de/messages.json";
import { messages as enMessages } from "@/locales/en/messages.json";

import { SubmissionNotice } from "./SubmissionNotice";

import type {
  ContentPart,
  SubmissionOutcome,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { UiChatMessage } from "@/utils/adapters/messageAdapter";
import type { Messages } from "@lingui/core";

vi.mock("@/hooks/ui/useThemedIcon", () => ({
  useThemedIcon: () => "status-warning",
}));

const NO_RESPONSE = "Word didn't respond; keep Word open and send again.";
const RELOADED =
  "The Word pane was reloaded, a newer request replaced this one, or this message wasn't sent with the document; send your request again from the Word pane.";
const READ_NO_RESPONSE =
  "Erato couldn't read the document because Word didn't respond. If the answer needs it, keep Word open and send again.";

type ToolUse = Extract<ContentPart, { content_type: "tool_use" }>;
const tool = (tool_name: string, output: unknown): ContentPart => ({
  content_type: "tool_use",
  tool_call_id: `${tool_name}-${Math.random()}`,
  tool_name,
  status: "error",
  output: output as ToolUse["output"],
});
const timedOut = (name: string) =>
  tool(name, { status: "cancelled", reason: "timeout" });
const rejected = (name: string, code: string) =>
  tool(name, {
    status: "error",
    validation_errors: [{ path: "/snapshot", code, message: "m" }],
    submission_feedback: { terminal: true, recovery: "cannot_continue" },
  });
const unresolved = (reason: SubmissionOutcome["reason"]) => ({
  status: "unresolved" as const,
  reason,
  attempts_used: 1,
  max_attempts: 5,
});

const message = (
  content: ContentPart[],
  overrides: Partial<UiChatMessage> = {},
): UiChatMessage => ({
  id: "msg",
  content,
  role: "assistant",
  sender: "assistant",
  authorId: "assistant_1",
  createdAt: new Date("2026-11-15T12:00:00Z").toISOString(),
  status: "complete",
  ...overrides,
});

const renderNotice = async (value: UiChatMessage, locale = "en") => {
  const { i18n } = await import("@lingui/core");
  i18n.load(
    locale,
    (locale === "de" ? deMessages : enMessages) as unknown as Messages,
  );
  i18n.activate(locale);
  return render(
    <I18nProvider i18n={i18n}>
      <SubmissionNotice message={value} />
    </I18nProvider>,
  );
};

describe("SubmissionNotice when Word was not there to answer", () => {
  it("says Word didn't respond when a plan submission timed out", async () => {
    await renderNotice(
      message(
        [timedOut("read_document_blocks"), timedOut("submit_document_plan")],
        {
          submission_outcome: unresolved("timeout"),
        },
      ),
    );
    expect(screen.getByTestId("submission-unresolved")).toHaveTextContent(
      `No valid proposal was prepared${NO_RESPONSE}`,
    );
  });

  it("says Word reloaded when the plan reached a pane without this request's read", async () => {
    await renderNotice(
      message([rejected("submit_document_plan", "wrong-request")], {
        submission_outcome: unresolved("context_unavailable"),
      }),
    );
    expect(screen.getByText(RELOADED)).toBeInTheDocument();
  });

  it("keeps the general wording when the context ended for another reason or another tool timed out", async () => {
    const { unmount } = await renderNotice(
      message([rejected("submit_document_plan", "snapshot-revoked")], {
        submission_outcome: unresolved("context_unavailable"),
      }),
    );
    expect(
      screen.getByText(
        "The source context is no longer available for this request.",
      ),
    ).toBeInTheDocument();
    unmount();
    await renderNotice(
      message([timedOut("submit_draft")], {
        submission_outcome: unresolved("timeout"),
      }),
    );
    expect(
      screen.getByText("The host did not return a result in time."),
    ).toBeInTheDocument();
  });

  it("speaks for the section plan and parts of a change in parts", async () => {
    const { unmount } = await renderNotice(
      message(
        [
          tool("plan_document_sections", { status: "success", result: {} }),
          timedOut("write_document_section"),
        ],
        { submission_outcome: unresolved("timeout") },
      ),
    );
    expect(screen.getByText(NO_RESPONSE)).toBeInTheDocument();
    unmount();
    await renderNotice(
      message([rejected("plan_document_sections", "wrong-request")], {
        submission_outcome: unresolved("context_unavailable"),
      }),
    );
    expect(screen.getByText(RELOADED)).toBeInTheDocument();
  });

  it("says Word didn't respond when no pane was connected to run the plan", async () => {
    await renderNotice(
      message(
        [
          tool("submit_document_plan", {
            status: "cancelled",
            reason: "context_unavailable",
          }),
        ],
        { submission_outcome: unresolved("context_unavailable") },
      ),
    );
    expect(screen.getByText(NO_RESPONSE)).toBeInTheDocument();
  });

  it("says Word reloaded when comment changes reached a pane without this request's comments", async () => {
    await renderNotice(
      message(
        [rejected("word_submit_comment_changes", "comments-unavailable")],
        { submission_outcome: unresolved("context_unavailable") },
      ),
    );
    expect(screen.getByText(RELOADED)).toBeInTheDocument();
  });

  it("speaks up for a Word read that failed before any proposal, without asking to resend an answer that may be complete", async () => {
    const { unmount } = await renderNotice(
      message([timedOut("read_document_blocks")]),
    );
    expect(screen.getByTestId("submission-unresolved")).toHaveTextContent(
      READ_NO_RESPONSE,
    );
    expect(
      screen.queryByText("No valid proposal was prepared"),
    ).not.toBeInTheDocument();
    unmount();
    await renderNotice(
      message([rejected("read_document_blocks", "read-unavailable")]),
    );
    expect(screen.getByText(RELOADED)).toBeInTheDocument();
  });

  it("stays quiet while the turn runs, after a later read succeeded, and for other tools", async () => {
    for (const value of [
      message([timedOut("read_document_blocks")], { status: "sending" }),
      message([
        timedOut("read_document_blocks"),
        tool("read_document_blocks", { status: "success", result: {} }),
      ]),
      message([timedOut("fetch_availability")]),
    ]) {
      const { container, unmount } = await renderNotice(value);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("is German for a German user", async () => {
    await renderNotice(
      message([timedOut("submit_document_plan")], {
        submission_outcome: unresolved("timeout"),
      }),
      "de",
    );
    expect(screen.getByTestId("submission-unresolved")).toHaveTextContent(
      "Es wurde kein gültiger Vorschlag erstelltWord hat nicht geantwortet. Lass Word geöffnet und sende die Nachricht noch einmal.",
    );
  });

  it("is German for a German user after a read Word didn't answer", async () => {
    await renderNotice(message([timedOut("read_document_blocks")]), "de");
    expect(screen.getByTestId("submission-unresolved")).toHaveTextContent(
      "Erato konnte das Dokument nicht lesen, weil Word nicht geantwortet hat. Falls die Antwort das Dokument braucht, lass Word geöffnet und sende die Nachricht noch einmal.",
    );
  });
});

describe("SubmissionNotice reasons", () => {
  it("says the part limit was reached, not that correction attempts ran out", async () => {
    await renderNotice(
      message([], {
        submission_outcome: {
          status: "unresolved",
          reason: "part_calls_exhausted",
          attempts_used: 0,
          max_attempts: 5,
        },
      }),
    );
    expect(screen.getByTestId("submission-unresolved")).toHaveTextContent(
      "No valid proposal was preparedErato reached the limit of parts it can write in one request; ask for a smaller change.",
    );
  });
});
