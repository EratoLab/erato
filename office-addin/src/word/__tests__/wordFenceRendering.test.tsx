import {
  componentRegistry,
  FeatureConfigProvider,
  MessageContent,
  ThemeProvider,
} from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SHARED_ADDIN_FEATURE_CONFIG } from "../../core/SharedAddinShell";
import { installWordComponentRegistrations } from "../installWordComponentRegistrations";
import { buildWordArtifact } from "../utils/buildWordArtifact";

import type { ContentPart, HostArtifact } from "@erato/frontend/library";

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
