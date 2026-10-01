import {
  componentRegistry,
  ConversationMessagesProvider,
  FeatureConfigProvider,
  MessageContent,
  ThemeProvider,
} from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SHARED_ADDIN_FEATURE_CONFIG } from "../../core/SharedAddinShell";
import { installWordComponentRegistrations } from "../installWordComponentRegistrations";
import { buildWordArtifact } from "../utils/buildWordArtifact";

import type {
  ContentPart,
  HostArtifact,
  Message,
} from "@erato/frontend/library";

vi.mock("@erato/frontend/library", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useChatContext: () => ({
    messages: {},
    messageOrder: [],
    currentChatId: null,
  }),
  useConfirmationRegistryStore: (
    selector: (state: {
      registerConfirmation: () => void;
      unregisterConfirmation: () => void;
    }) => unknown,
  ) =>
    selector({
      registerConfirmation: () => {},
      unregisterConfirmation: () => {},
    }),
  usePersistedState: () => [{}, () => {}],
}));

/** Keep fence classification and the host renderer real; only chat-shell hooks are stubbed. */
const EDITS_FENCE =
  '```erato-word-edits\n{"edits":[{"paragraph":2,"text":"Revised."}]}\n```';
const INSERT_FENCE = "```erato-word-insert\nA drafted paragraph.\n```";
const UNRELATED_FENCE = '```json\n{"paragraph": 2}\n```';

const textContent = (text: string): ContentPart[] =>
  [{ content_type: "text", text }] as unknown as ContentPart[];

function renderMessage(content: ContentPart[], hostArtifact: HostArtifact) {
  return render(
    <ThemeProvider>
      <FeatureConfigProvider config={SHARED_ADDIN_FEATURE_CONFIG}>
        <MessageContent content={content} hostArtifact={hostArtifact} />
      </FeatureConfigProvider>
    </ThemeProvider>,
  );
}

const WORD_ARTIFACT = buildWordArtifact({
  facetId: "word_document_review",
  clientActionInfo: {
    clientActions: ["word.apply_edits"],
    alwaysAskActions: [],
  },
  content: undefined,
  messageId: "m1",
  capture: undefined,
})!;

describe("the Word fences through the shipped host-card slot", () => {
  beforeEach(() => {
    i18n.load("en", {});
    i18n.activate("en");
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
  });
  afterEach(() => {
    componentRegistry.HostCardCodeBlock = null;
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders BOTH fences as Word cards and leaves an unrelated fence alone", () => {
    installWordComponentRegistrations();

    const { container } = renderMessage(
      textContent(`${EDITS_FENCE}\n\n${INSERT_FENCE}\n\n${UNRELATED_FENCE}`),
      WORD_ARTIFACT,
    );

    expect(
      container.querySelector('[data-testid="word-edits-card"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="word-insert-card"]'),
    ).not.toBeNull();
    expect(
      container.querySelectorAll("pre.message-content-code-block"),
    ).toHaveLength(1);
  });

  it("falls back to plain code blocks when cardFenceLanguages is omitted", () => {
    installWordComponentRegistrations();
    const { cardFenceLanguages: _dropped, ...withoutLanguages } = WORD_ARTIFACT;

    const { container } = renderMessage(
      textContent(`${EDITS_FENCE}\n\n${INSERT_FENCE}`),
      withoutLanguages,
    );

    expect(
      container.querySelector('[data-testid="word-edits-card"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="word-insert-card"]'),
    ).toBeNull();
    expect(
      container.querySelectorAll("pre.message-content-code-block"),
    ).toHaveLength(2);
  });

  it("matches the fence tags exactly — no drifted tag is rescued", () => {
    installWordComponentRegistrations();

    const { container } = renderMessage(
      textContent(
        '```word-edits\n{"edits":[]}\n```\n\n```Erato-Word-Edits\n{"edits":[]}\n```',
      ),
      WORD_ARTIFACT,
    );

    expect(
      container.querySelector('[data-testid="word-edits-card"]'),
    ).toBeNull();
    expect(
      container.querySelectorAll("pre.message-content-code-block"),
    ).toHaveLength(2);
  });

  it("leaves the fences as code blocks while no renderer is registered", () => {
    expect(componentRegistry.HostCardCodeBlock).toBeNull();

    const { container } = renderMessage(
      textContent(EDITS_FENCE),
      WORD_ARTIFACT,
    );

    expect(
      container.querySelectorAll("pre.message-content-code-block"),
    ).toHaveLength(1);
  });
});

describe("Word chats inside the Word host", () => {
  beforeEach(() => {
    i18n.load("en", {});
    i18n.activate("en");
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
  });
  afterEach(() => {
    componentRegistry.HostCardCodeBlock = null;
    vi.unstubAllGlobals();
    cleanup();
  });

  const submitPart = {
    content_type: "tool_use",
    tool_name: "submit_document_plan",
    tool_call_id: "submit-1",
    status: "success",
    input: { snapshot: "snap" },
    output: { status: "success", submission: { status: "retry" } },
  };

  function renderConversation(hostArtifact: HostArtifact | undefined) {
    const assistant = {
      id: "m1",
      role: "assistant",
      previous_message_id: "u1",
      createdAt: "2026-10-01T00:00:01Z",
      content: [
        submitPart,
        { content_type: "text", text: EDITS_FENCE },
      ] as unknown as ContentPart[],
    } satisfies Message;
    const messages: Record<string, Message> = {
      u1: {
        id: "u1",
        role: "user",
        createdAt: "2026-10-01T00:00:00Z",
        content: [],
        action_facet_id: "word_document_review",
        action_facet_args: { document_name: "Report.docx" },
      },
      m1: assistant,
    };
    return render(
      <ThemeProvider>
        <FeatureConfigProvider config={SHARED_ADDIN_FEATURE_CONFIG}>
          <ConversationMessagesProvider messages={messages}>
            <MessageContent
              content={assistant.content}
              messageId="m1"
              hostArtifact={hostArtifact}
            />
          </ConversationMessagesProvider>
        </FeatureConfigProvider>
      </ThemeProvider>,
    );
  }

  it("keeps the live Word card for a stamped message", () => {
    installWordComponentRegistrations();

    const { container } = renderConversation(WORD_ARTIFACT);

    expect(
      container.querySelector('[data-testid="word-edits-card"]'),
    ).not.toBeNull();
    expect(screen.queryByTestId("word-history-edits")).toBeNull();
    expect(screen.queryByTestId("word-history-no-changes")).toBeNull();
  });

  it("shows no read-only history card for an unstamped message", () => {
    installWordComponentRegistrations();

    const { container } = renderConversation(undefined);

    expect(screen.queryByTestId("word-history-edits")).toBeNull();
    expect(screen.queryByTestId("word-history-no-changes")).toBeNull();
    expect(
      container.querySelectorAll("pre.message-content-code-block"),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-tool-name="submit_document_plan"]'),
    ).not.toBeNull();
  });

  it("shows the read-only cards in a host without a Word card renderer", async () => {
    const { container } = renderConversation(undefined);

    expect(await screen.findByTestId("word-history-edits")).toBeTruthy();
    expect(await screen.findByTestId("word-history-no-changes")).toBeTruthy();
    expect(
      container.querySelector('[data-tool-name="submit_document_plan"]'),
    ).toBeNull();
  });
});
