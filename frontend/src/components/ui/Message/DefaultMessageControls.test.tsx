import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DefaultMessageControls } from "./DefaultMessageControls";

vi.mock("@/components/ui/Message/MessageTimestamp", () => ({
  MessageTimestamp: () => <time data-testid="message-timestamp">now</time>,
}));

describe("DefaultMessageControls", () => {
  it("uses token-driven spacing and controls surface styling", () => {
    const { container } = render(
      <DefaultMessageControls
        messageId="msg_1"
        createdAt={new Date("2025-01-01T12:00:00Z").toISOString()}
        context={{ canEdit: true, isSharedDialog: false }}
        onAction={vi.fn(async () => true)}
        isUserMessage={false}
        showFeedbackButtons={true}
      />,
    );

    const controlsRow = container.querySelector('[data-ui="message-controls"]');
    const controlsSurface = controlsRow?.firstElementChild;

    expect(controlsRow).toHaveStyle({
      gap: "var(--theme-spacing-control-gap)",
    });
    expect(controlsSurface).toHaveStyle({
      gap: "var(--theme-spacing-control-gap)",
    });
    const copyButton = container.querySelector(
      'button[aria-label="Copy message"]',
    );
    expect(copyButton?.className).toContain(
      "hover:bg-[var(--theme-message-controls)]",
    );
  });

  it("shows regenerate for assistant messages and dispatches the action", async () => {
    const onAction = vi.fn(async () => true);

    render(
      <DefaultMessageControls
        messageId="assistant_1"
        createdAt={new Date("2025-01-01T12:00:00Z").toISOString()}
        context={{ canEdit: true, isSharedDialog: false }}
        onAction={onAction}
        isUserMessage={false}
      />,
    );

    fireEvent.click(screen.getByLabelText("Regenerate response"));

    expect(onAction).toHaveBeenCalledWith({
      type: "regenerate",
      messageId: "assistant_1",
    });
  });

  it("does not show regenerate for user messages", () => {
    render(
      <DefaultMessageControls
        messageId="user_1"
        createdAt={new Date("2025-01-01T12:00:00Z").toISOString()}
        context={{ canEdit: true, isSharedDialog: false }}
        onAction={vi.fn(async () => true)}
        isUserMessage={true}
      />,
    );

    expect(
      screen.queryByLabelText("Regenerate response"),
    ).not.toBeInTheDocument();
  });
});
