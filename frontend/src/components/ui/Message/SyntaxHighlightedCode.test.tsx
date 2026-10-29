import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { messages as enMessages } from "@/locales/en/messages.json";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import { MessageContent } from "./MessageContent";

import type { Messages } from "@lingui/core";

const highlightedCode = vi.hoisted(() => [] as string[]);

vi.mock("react-syntax-highlighter", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("react-syntax-highlighter")>();
  const { createElement } = await import("react");
  const Prism = (props: { children: string }) => {
    highlightedCode.push(props.children);
    return createElement(actual.Prism, props as never);
  };
  return { ...actual, Prism };
});

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

const FINISHED = "const answer = 42;\nconsole.log(answer);";

const streamingMessage = (tail: string) => (
  <I18nProvider i18n={i18n}>
    <StaticFeatureConfigProvider>
      <ThemeProvider enableCustomTheme={false}>
        <MessageContent
          content={[
            {
              content_type: "text",
              text: `\`\`\`ts\n${FINISHED}\n\`\`\`\n\nStill streaming${tail}`,
            },
          ]}
          messageId="m1"
          isStreaming
        />
      </ThemeProvider>
    </StaticFeatureConfigProvider>
  </I18nProvider>
);

describe("SyntaxHighlightedCode", () => {
  it("highlights a finished code block once while its message keeps streaming", () => {
    const { rerender } = render(streamingMessage(""));
    for (const tail of [" one", " one two", " one two three"]) {
      rerender(streamingMessage(tail));
    }

    expect(
      highlightedCode.filter((code) => code.includes("const answer")),
    ).toHaveLength(1);
  });
});
