import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { MessageErrorAlert } from "./MessageErrorAlert";

import type { MessageError } from "@/types/chat";
import type { UiChatMessage } from "@/utils/adapters/messageAdapter";
import type { Messages } from "@lingui/core";

const showVerboseAssistantErrorsMock = vi.hoisted(() => vi.fn(() => false));
const showCopyErrorReportMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useErrorReportFeature: () => ({
    showVerboseAssistantErrors: showVerboseAssistantErrorsMock(),
    showCopyErrorReport: showCopyErrorReportMock(),
  }),
}));

vi.mock("@/hooks/ui/useThemedIcon", () => ({
  useThemedIcon: () => "status-error",
}));

const failedMessage = (
  error: (Partial<MessageError> & Pick<MessageError, "error_type">) | undefined,
  overrides: Partial<UiChatMessage> = {},
): UiChatMessage => ({
  id: "msg_error_alert",
  content: [],
  role: "assistant",
  sender: "assistant",
  authorId: "assistant_1",
  createdAt: new Date("2025-01-01T12:00:00Z").toISOString(),
  status: "error",
  error: error && { error_description: "raw provider payload", ...error },
  ...overrides,
});

const renderAlert = async (message: UiChatMessage) => {
  const { i18n } = await import("@lingui/core");
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");

  return render(
    <I18nProvider i18n={i18n}>
      <MessageErrorAlert message={message} />
    </I18nProvider>,
  );
};

describe("MessageErrorAlert", () => {
  it("draws nothing for a message that did not fail", async () => {
    const { container } = await renderAlert(
      failedMessage(undefined, {
        content: [{ content_type: "text", text: "Answered" }],
        status: "complete",
      }),
    );

    expect(container).toBeEmptyDOMElement();
  });

  // One case per branch the copy module carries, because the reason a kit
  // copies this markup is to restyle it — and each branch it then fails to
  // learn about reads as the generic wording to that kit's users.
  it("words an unclassified failure generically, under the assistant-error title", async () => {
    await renderAlert(failedMessage({ error_type: "provider_error" }));

    expect(screen.getByTestId("chat-message-error")).toHaveTextContent(
      "Assistant error",
    );
    expect(
      screen.getByText("The assistant was unable to respond."),
    ).toBeInTheDocument();
  });

  it("names an aborted hallucination loop and asks for a regeneration", async () => {
    await renderAlert(failedMessage({ error_type: "hallucination_loop" }));

    expect(
      screen.getByText(
        "Generation aborted. Hallucination loop detected. Please regenerate the message.",
      ),
    ).toBeInTheDocument();
  });

  it("tells a rate limit apart and offers the wait-and-shrink remedy", async () => {
    await renderAlert(failedMessage({ error_type: "rate_limit" }));

    expect(
      screen.getByText(
        "Rate limit or quota exceeded. This can also happen if your input is too large.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Please try again in a minute, and reduce the length or number of attachments.",
      ),
    ).toBeInTheDocument();
  });

  it("quotes what a prompt-injection guardrail matched, and how to clear it", async () => {
    await renderAlert(
      failedMessage({
        error_type: "content_filter",
        filter_details: {
          pattern_id: "ignore_previous_instructions",
          matched_text: "Ignore all previous instructions",
        },
      }),
    );

    // A filtered response carries no title: the wording already says what
    // happened, and "Assistant error" would misattribute a policy decision.
    expect(screen.queryByText("Assistant error")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "The request was blocked because it matched a prompt injection guardrail.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Offending text")).toBeInTheDocument();
    expect(
      screen.getByText("Ignore all previous instructions"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Please edit the previous message to remove the offending text before continuing.",
      ),
    ).toBeInTheDocument();
  });

  it("lists the categories a content filter tripped, with their severities", async () => {
    await renderAlert(
      failedMessage({
        error_type: "content_filter",
        filter_details: {
          hate: { filtered: true, severity: "high" },
          self_harm: { filtered: false, severity: "safe" },
          violence: { filtered: true, severity: "medium" },
        },
      }),
    );

    expect(
      screen.getByText(
        "The response was filtered due to the prompt triggering content management policy.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Filtered categories")).toBeInTheDocument();
    expect(screen.getByText("Hate (high severity)")).toBeInTheDocument();
    expect(screen.getByText("Violence (medium severity)")).toBeInTheDocument();
    // Only what was actually filtered — an untripped category is noise.
    expect(screen.queryByText(/Self harm/)).not.toBeInTheDocument();
  });

  it("keeps the raw description out of the bubble until the flag allows it", async () => {
    const message = failedMessage({
      error_type: "provider_error",
      error_description: "Provider returned diagnostic details",
    });

    const { unmount } = await renderAlert(message);
    expect(screen.queryByText("Details")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Provider returned diagnostic details"),
    ).not.toBeInTheDocument();
    unmount();

    showVerboseAssistantErrorsMock.mockReturnValueOnce(true);
    await renderAlert(message);

    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(
      screen.getByText("Provider returned diagnostic details"),
    ).toBeInTheDocument();
  });

  // The verbose description is diagnostics; a filtered response is a policy
  // decision whose provider payload says nothing a user can act on.
  it("withholds the raw description from a filtered response even when enabled", async () => {
    showVerboseAssistantErrorsMock.mockReturnValueOnce(true);

    await renderAlert(
      failedMessage({
        error_type: "content_filter",
        error_description: "azure content management policy payload",
      }),
    );

    expect(screen.queryByText("Details")).not.toBeInTheDocument();
    expect(
      screen.queryByText("azure content management policy payload"),
    ).not.toBeInTheDocument();
  });

  it("offers the backend-rendered report only where one exists", async () => {
    const { unmount } = await renderAlert(
      failedMessage({ error_type: "provider_error" }),
    );
    expect(
      screen.queryByRole("button", { name: "Copy error report" }),
    ).not.toBeInTheDocument();
    unmount();

    await renderAlert(
      failedMessage(
        { error_type: "provider_error" },
        { error_report: "## Error Report\n\nprovider failed" },
      ),
    );

    expect(
      screen.getByRole("button", { name: "Copy error report" }),
    ).toBeInTheDocument();
  });

  it("suppresses the report button where the deployment disables it", async () => {
    showCopyErrorReportMock.mockReturnValueOnce(false);

    await renderAlert(
      failedMessage(
        { error_type: "provider_error" },
        { error_report: "## Error Report\n\nprovider failed" },
      ),
    );

    expect(
      screen.queryByRole("button", { name: "Copy error report" }),
    ).not.toBeInTheDocument();
  });
});
