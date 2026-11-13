import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { useMessageExplainStore } from "@/hooks/chat/store/messageExplainStore";
import { messages as enMessages } from "@/locales/en/messages.json";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import { MessageContent } from "../MessageContent";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";
import type { ComponentProps } from "react";

vi.mock("@/utils/sse/sseClient", () => ({
  createSSEConnection: vi.fn(() => vi.fn()),
}));

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

afterEach(() => {
  act(() => useMessageExplainStore.getState().close());
});

const content: ContentPart[] = [
  {
    content_type: "text",
    text: "First paragraph.\n\n- one\n- two\n\n```ts\nconst a = 1;\n```\n\nLast paragraph.",
  },
];

const ui = (
  props: Partial<ComponentProps<typeof MessageContent>> = {},
  actions = { quoteEnabled: true, explainEnabled: true },
) => (
  <I18nProvider i18n={i18n}>
    <StaticFeatureConfigProvider config={{ messageTextActions: actions }}>
      <ThemeProvider enableCustomTheme={false}>
        <MessageContent messageId="m1" content={content} {...props} />
      </ThemeProvider>
    </StaticFeatureConfigProvider>
  </I18nProvider>
);

const blockKeys = () =>
  Array.from(document.querySelectorAll("[data-text-block]")).map((block) =>
    block.getAttribute("data-text-block"),
  );

const openCardAfter = (endBlock: string) =>
  act(() =>
    useMessageExplainStore.getState().open({
      messageId: "m1",
      passage: "one",
      anchor: { startBlock: endBlock, startOffset: 0, endBlock, endOffset: 3 },
    }),
  );

describe("MessageContent as the text of a message", () => {
  it("marks its root in every state", () => {
    const { container, rerender } = render(
      ui({}, { quoteEnabled: false, explainEnabled: false }),
    );
    expect(container.firstElementChild).toHaveAttribute(
      "data-ui",
      "message-content",
    );

    rerender(ui({ showRaw: true }));
    expect(container.firstElementChild).toHaveAttribute(
      "data-ui",
      "message-content",
    );
  });

  it("marks the top-level blocks of a finished message once an action is enabled", () => {
    render(ui({}, { quoteEnabled: true, explainEnabled: false }));

    expect(blockKeys()).toEqual(["0:0", "0:1", "0:2", "0:3"]);
    expect(document.querySelector('[data-text-block="0:1"]')?.tagName).toBe(
      "UL",
    );
    expect(document.querySelector('[data-text-block="0:2"]')?.tagName).toBe(
      "PRE",
    );
  });

  it.each([
    [
      "no action is enabled",
      {},
      { quoteEnabled: false, explainEnabled: false },
    ],
    ["the message is streaming", { isStreaming: true }, undefined],
    ["the view is a shared, read-only one", { readOnly: true }, undefined],
    ["the content belongs to no message", { messageId: undefined }, undefined],
  ])("marks no blocks when %s", (_case, props, actions) => {
    render(ui(props, actions));

    expect(blockKeys()).toEqual([]);
  });

  it("renders the small chat below the block that holds the end of the passage", () => {
    render(ui());

    openCardAfter("0:1");

    const card = screen.getByRole("group", { name: "Explain: one" });
    expect(card.previousElementSibling).toBe(
      document.querySelector('[data-text-block="0:1"]'),
    );
    expect(blockKeys()).toEqual(["0:0", "0:1", "0:2", "0:3"]);
    // An answer is drawn by MessageContent itself, and carries no block marks.
    expect(card.querySelectorAll("[data-text-block]")).toHaveLength(0);
  });

  it("renders an answer as message text", () => {
    render(ui());
    openCardAfter("0:0");
    act(() =>
      useMessageExplainStore.setState((state) => ({
        card: state.card && {
          ...state.card,
          turns: [
            {
              id: 1,
              question: null,
              answer: "A **deal** with the provider.",
              status: "done",
            },
          ],
        },
      })),
    );

    const answer = screen
      .getByRole("group", { name: "Explain: one" })
      .querySelector('[data-ui="message-content"]');
    expect(answer?.querySelector("strong")).toHaveTextContent("deal");
  });

  it("shows no card for another message's small chat", () => {
    render(ui({ messageId: "m2" }));

    openCardAfter("0:1");

    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("discards the small chat when the message is switched to raw markdown", () => {
    const { rerender } = render(ui());
    openCardAfter("0:1");

    rerender(ui({ showRaw: true }));

    expect(useMessageExplainStore.getState().card).toBeNull();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });
});
