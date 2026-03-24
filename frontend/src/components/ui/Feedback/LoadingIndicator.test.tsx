import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LoadingIndicator } from "./LoadingIndicator";

vi.mock("@/components/ui/icons", () => ({
  ToolsIcon: () => <svg aria-hidden="true" />,
  SettingsIcon: () => <svg aria-hidden="true" />,
  CheckCircleIcon: () => <svg aria-hidden="true" />,
  ErrorIcon: () => <svg aria-hidden="true" />,
  TimerIcon: () => <svg aria-hidden="true" />,
  BrainIcon: () => <svg aria-hidden="true" />,
}));

describe("LoadingIndicator", () => {
  it("maps tool-call statuses to semantic status tokens", () => {
    render(
      <LoadingIndicator
        state="tool-calling"
        toolCalls={{
          proposed: {
            id: "call-proposed",
            name: "Draft tool",
            status: "proposed",
          },
          progress: {
            id: "call-progress",
            name: "Running tool",
            status: "in_progress",
          },
          success: {
            id: "call-success",
            name: "Completed tool",
            status: "success",
          },
          error: {
            id: "call-error",
            name: "Failed tool",
            status: "error",
          },
        }}
      />,
    );

    expect(screen.getByText("Draft tool").closest("div")?.className).toContain(
      "text-theme-fg-secondary",
    );
    expect(
      screen.getByText("Running tool").closest("div")?.className,
    ).toContain("text-theme-info-fg");
    expect(
      screen.getByText("Completed tool").closest("div")?.className,
    ).toContain("text-theme-success-fg");
    expect(screen.getByText("Failed tool").closest("div")?.className).toContain(
      "text-theme-error-fg",
    );
  });

  it("only pulses tool-call rows for active statuses", () => {
    render(
      <LoadingIndicator
        state="tool-calling"
        toolCalls={{
          proposed: {
            id: "call-proposed",
            name: "Draft tool",
            status: "proposed",
          },
          progress: {
            id: "call-progress",
            name: "Running tool",
            status: "in_progress",
          },
          success: {
            id: "call-success",
            name: "Completed tool",
            status: "success",
          },
          error: {
            id: "call-error",
            name: "Failed tool",
            status: "error",
          },
        }}
      />,
    );

    expect(screen.getByText("Draft tool").closest("div")?.className).toContain(
      "animate-pulse",
    );
    expect(
      screen.getByText("Running tool").closest("div")?.className,
    ).toContain("animate-pulse");
    expect(
      screen.getByText("Completed tool").closest("div")?.className,
    ).not.toContain("animate-pulse");
    expect(screen.getByText("Failed tool").closest("div")?.className).not.toContain(
      "animate-pulse",
    );
  });

  it("keeps the default loading indicator layout and copy intact", () => {
    const { container } = render(
      <LoadingIndicator state="reasoning" context="Gathering context" />,
    );

    const indicator = container.firstElementChild;

    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.getByText("Gathering context")).toBeInTheDocument();
    expect(indicator?.className).toContain("flex");
    expect(indicator?.className).toContain("items-center");
    expect(indicator?.className).toContain("gap-2");
    expect(indicator?.className).toContain("text-theme-fg-secondary");
    expect(indicator?.className).toContain("animate-pulse");
  });

  it("only pulses for active loading states", () => {
    const { container, rerender } = render(<LoadingIndicator state="thinking" />);

    expect(container.firstElementChild?.className).toContain("animate-pulse");

    rerender(<LoadingIndicator state="error" />);
    expect(container.firstElementChild?.className).not.toContain(
      "animate-pulse",
    );

    rerender(<LoadingIndicator state="done" />);
    expect(container.firstElementChild?.className).not.toContain(
      "animate-pulse",
    );
  });
});
