import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToolCallDisplay } from "./ToolCallDisplay";

vi.mock(".", () => ({
  ToolCallItem: ({ toolCall }: { toolCall: { id: string } }) => (
    <div data-testid={`tool-call-item-${toolCall.id}`} />
  ),
}));

vi.mock("@/components/ui/icons", () => ({
  ToolsIcon: () => <svg aria-hidden="true" />,
  CheckIcon: () => <svg aria-hidden="true" />,
  ErrorIcon: () => <svg aria-hidden="true" />,
}));

describe("ToolCallDisplay", () => {
  it("uses the existing message and control geometry contract for the summary frame", () => {
    const toolCalls = [
      { id: "call-1", status: "success" },
      { id: "call-2", status: "error" },
    ];

    const { container } = render(
      <ToolCallDisplay
        toolCalls={toolCalls as never}
        defaultExpanded={false}
        allowToggle={true}
      />,
    );

    const frame = container.firstElementChild;
    const header = screen.getByRole("button");

    expect(frame).toHaveStyle({
      borderRadius: "var(--theme-radius-message)",
    });
    expect(header).toHaveStyle({
      gap: "var(--theme-spacing-control-gap)",
      padding:
        "var(--theme-spacing-control-padding-y) var(--theme-spacing-message-padding-x)",
    });
  });
});
