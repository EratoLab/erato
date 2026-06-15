import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { ReasoningStep } from "./ReasoningStep";

import type { Messages } from "@lingui/core";

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

const defaultSegment = {
  title: "Model reasoning title",
  body: "Model reasoning body text",
};

const renderReasoningStep = (
  props: Partial<Parameters<typeof ReasoningStep>[0]> = {},
) => {
  return render(
    <I18nProvider i18n={i18n}>
      <ReasoningStep
        segment={defaultSegment}
        status="done"
        isStreaming={false}
        isCollapsed={true}
        isLastStep={false}
        renderMarkdown={(text) => <span>{text}</span>}
        {...props}
      />
    </I18nProvider>,
  );
};

describe("ReasoningStep — default (unmasked) mode", () => {
  it("renders the segment title when not masked", () => {
    renderReasoningStep();
    expect(screen.getByText("Model reasoning title")).toBeInTheDocument();
  });

  it("renders the segment body when not masked", () => {
    renderReasoningStep();
    expect(screen.getByText("Model reasoning body text")).toBeInTheDocument();
  });

  it("does not render the masked label when maskReasoningText is false", () => {
    renderReasoningStep({ maskReasoningText: false });
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
  });

  it("uses the fallback title when segment has no title", () => {
    renderReasoningStep({
      segment: { title: "", body: "Some body text" },
    });
    expect(screen.getByText("Thinking")).toBeInTheDocument();
  });
});

describe("ReasoningStep — masked mode (done state)", () => {
  it("renders the done label when status is done and not streaming", () => {
    renderReasoningStep({ maskReasoningText: true });
    expect(screen.getByText("Thinking complete")).toBeInTheDocument();
  });

  it("does not pulse the label when done", () => {
    renderReasoningStep({ maskReasoningText: true });
    // The done label itself must not have the animate-pulse class.
    const label = screen.getByText("Thinking complete");
    expect(label).not.toHaveClass("animate-pulse");
  });

  it("does not render the model-generated title when masked and done", () => {
    renderReasoningStep({ maskReasoningText: true });
    expect(screen.queryByText("Model reasoning title")).not.toBeInTheDocument();
  });

  it("does not render model-generated body text when masked and done", () => {
    renderReasoningStep({ maskReasoningText: true });
    expect(
      screen.queryByText("Model reasoning body text"),
    ).not.toBeInTheDocument();
  });
});

describe("ReasoningStep — masked mode (running/active state)", () => {
  it("renders the active pulsing label when running", () => {
    renderReasoningStep({
      maskReasoningText: true,
      status: "running",
      isStreaming: true,
    });
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
  });

  it("does not render the done label when actively running", () => {
    renderReasoningStep({
      maskReasoningText: true,
      status: "running",
      isStreaming: true,
    });
    expect(screen.queryByText("Thinking complete")).not.toBeInTheDocument();
  });

  it("active masked label has pulsing animation class", () => {
    renderReasoningStep({
      maskReasoningText: true,
      status: "running",
      isStreaming: true,
    });
    // The rail icon also gets animate-pulse when isActive; find the label span by text.
    const label = screen.getByText("Thinking…");
    expect(label).toHaveClass("animate-pulse");
  });

  it("does not render model-generated title or body when running and masked", () => {
    renderReasoningStep({
      maskReasoningText: true,
      status: "running",
      isStreaming: true,
    });
    expect(screen.queryByText("Model reasoning title")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Model reasoning body text"),
    ).not.toBeInTheDocument();
  });
});
