import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { i18n } from "@lingui/core";
import { messages as enMessages } from "@/locales/en/messages.json";

import type { Messages } from "@lingui/core";

import { ReasoningStep } from "./ReasoningStep";

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

const defaultSegment = {
  title: "Model reasoning title",
  body: "Model reasoning body text",
};

const renderReasoningStep = (props: Partial<Parameters<typeof ReasoningStep>[0]> = {}) => {
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

describe("ReasoningStep — masked mode", () => {
  it("renders the masked label instead of the segment title", () => {
    renderReasoningStep({ maskReasoningText: true });
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
  });

  it("does not render the model-generated title when masked", () => {
    renderReasoningStep({ maskReasoningText: true });
    expect(screen.queryByText("Model reasoning title")).not.toBeInTheDocument();
  });

  it("does not render model-generated body text when masked", () => {
    renderReasoningStep({ maskReasoningText: true });
    expect(screen.queryByText("Model reasoning body text")).not.toBeInTheDocument();
  });

  it("masked label has pulsing animation class", () => {
    const { container } = renderReasoningStep({ maskReasoningText: true });
    const span = container.querySelector(".animate-pulse");
    expect(span).toBeInTheDocument();
    expect(span).toHaveTextContent("Thinking…");
  });
});
