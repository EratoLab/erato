import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { Trace } from "./Trace";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";


beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

// Default mock: masking disabled
const mockUseTraceFeature = vi.fn(() => ({ maskReasoningText: false }));

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useTraceFeature: () => mockUseTraceFeature(),
}));

const reasoningPart = (text: string): ContentPart =>
  ({
    content_type: "reasoning",
    text,
  });

const toolUsePart = (): ContentPart =>
  ({
    content_type: "tool_use",
    status: "success",
    tool_call_id: "tool-abc",
    tool_name: "web_search",
    input: null,
    output: null,
    progress_message: null,
    started_at: null,
    ended_at: null,
  });

const renderTrace = (parts: ContentPart[], overrides: { maskReasoningText?: boolean } = {}) => {
  mockUseTraceFeature.mockReturnValue({ maskReasoningText: overrides.maskReasoningText ?? false });

  return render(
    <I18nProvider i18n={i18n}>
      <Trace
        parts={parts as Parameters<typeof Trace>[0]["parts"]}
        isStreaming={false}
        hasLaterContent={false}
        renderMarkdown={(text) => <span>{text}</span>}
        durationMs={null}
      />
    </I18nProvider>,
  );
};

describe("Trace — default (unmasked) mode", () => {
  it("renders reasoning segment title without masking", () => {
    renderTrace([reasoningPart("**Analyzing the request**\n\nLet me think through this.")]);
    expect(screen.getByText("Analyzing the request")).toBeInTheDocument();
  });

  it("does not show the masked label when masking is disabled", () => {
    renderTrace([reasoningPart("Some reasoning text")], { maskReasoningText: false });
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
  });
});

describe("Trace — masked mode", () => {
  it("replaces reasoning title with the masked label", () => {
    renderTrace(
      [reasoningPart("**Model reasoning title**\n\nModel reasoning body")],
      { maskReasoningText: true },
    );
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
    expect(screen.queryByText("Model reasoning title")).not.toBeInTheDocument();
  });

  it("does not render model-generated reasoning body when masked", () => {
    renderTrace(
      [reasoningPart("Some reasoning body text")],
      { maskReasoningText: true },
    );
    expect(screen.queryByText("Some reasoning body text")).not.toBeInTheDocument();
  });

  it("still renders tool call steps when masking is enabled", () => {
    renderTrace([reasoningPart("Some reasoning"), toolUsePart()], { maskReasoningText: true });
    // The masked label is shown for the reasoning step
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
    // The tool use step should still render (search tool)
    expect(screen.getByText("web_search")).toBeInTheDocument();
  });
});
