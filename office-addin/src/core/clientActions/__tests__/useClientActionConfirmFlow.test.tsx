import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useClientActionConfirmFlow } from "../useClientActionConfirmFlow";

import type { ClientActionDecisionMap } from "../clientActionPolicy";

const chatContext = vi.hoisted(() => ({
  messages: {},
  messageOrder: [] as string[],
  currentChatId: "chat-1",
}));
const registry = vi.hoisted(() => ({
  registerConfirmation: vi.fn(),
  unregisterConfirmation: vi.fn(),
}));

// The hook's ONLY library imports; the Outlook renderer tests hand-write the
// same two, so a new import here would break them as well.
vi.mock("@erato/frontend/library", () => ({
  useChatContext: () => chatContext,
  useConfirmationRegistryStore: (
    selector: (state: typeof registry) => unknown,
  ) => selector(registry),
}));

// A non-Outlook action union: the type-level goal of the hoist. This file
// fails to compile if the bound ever narrows back to an Outlook type.
type WordClientAction = "word.apply_edits" | "word.insert_text";
type EditSummary = { paragraphs: number };

let messageSeq = 0;
function freshMessageId(): string {
  messageSeq += 1;
  return `msg-${messageSeq}`;
}

type FlowArgs = Parameters<
  typeof useClientActionConfirmFlow<EditSummary, WordClientAction>
>[0];

function setup(overrides: Partial<FlowArgs> = {}) {
  const messageId = overrides.messageId ?? freshMessageId();
  chatContext.messages = { [messageId]: { role: "assistant" } };
  chatContext.messageOrder = [messageId];
  const execute = vi.fn<
    (
      action: WordClientAction,
      itemIdentityAtOpen?: string | null,
    ) => Promise<boolean>
  >(() => Promise.resolve(true));
  const buildSummary = vi.fn<(action: WordClientAction) => EditSummary | null>(
    () => ({ paragraphs: 2 }),
  );
  const decisions: ClientActionDecisionMap = {};
  const hook = renderHook(() =>
    useClientActionConfirmFlow<EditSummary, WordClientAction>({
      promptScope: "edits",
      facetId: "word_edit_selection",
      decisions,
      enforcedAskActions: [],
      buildSummary,
      execute,
      itemIdentity: "doc-1",
      presentation: undefined,
      messageId,
      isFreshCompletion: false,
      proposedAction: undefined,
      expectedItemIdentity: "doc-1",
      currentItemIdentity: "doc-1",
      ...overrides,
    }),
  );
  return { ...hook, execute, buildSummary, messageId };
}

describe("useClientActionConfirmFlow (host-neutral)", () => {
  it("opens a card with a snapshotted summary and closes it on deny", () => {
    const { result } = setup();
    expect(result.current.confirmCard).toBeNull();

    act(() => {
      expect(result.current.requestConfirmation("word.apply_edits")).toBe(true);
    });
    const card = result.current.confirmCard;
    expect(card).toMatchObject({
      action: "word.apply_edits",
      summary: { paragraphs: 2 },
      autoTriggered: false,
      itemIdentityAtOpen: "doc-1",
    });
    expect(result.current.isConfirmPending).toBe(true);

    act(() => {
      result.current.denyCard(card!);
    });
    expect(result.current.confirmCard).toBeNull();
  });

  it("does not open a card when the summary cannot be snapshotted", () => {
    const { result } = setup({ buildSummary: () => null });
    act(() => {
      expect(result.current.requestConfirmation("word.apply_edits")).toBe(
        false,
      );
    });
    expect(result.current.confirmCard).toBeNull();
  });

  it("allow executes with the card's item identity, then closes THAT card", async () => {
    const { result, execute } = setup();
    act(() => {
      result.current.requestConfirmation("word.insert_text");
    });
    const card = result.current.confirmCard!;
    act(() => {
      result.current.allowCard(card);
    });
    expect(execute).toHaveBeenCalledWith("word.insert_text", "doc-1");
    await waitFor(() => expect(result.current.confirmCard).toBeNull());
  });

  it("a newer request replaces the card and an old allow leaves the new one open", async () => {
    const { result } = setup();
    act(() => {
      result.current.requestConfirmation("word.apply_edits");
    });
    const first = result.current.confirmCard!;
    act(() => {
      result.current.requestConfirmation("word.insert_text");
    });
    const second = result.current.confirmCard!;
    expect(second.requestId).toBeGreaterThan(first.requestId);

    act(() => {
      result.current.allowCard(first);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.confirmCard).toBe(second);
  });

  it("registers a pending confirmation for the chat while a card is open", () => {
    const { result } = setup();
    act(() => {
      result.current.requestConfirmation("word.apply_edits");
    });
    expect(registry.registerConfirmation).toHaveBeenCalledWith(
      "chat-1",
      expect.any(String),
    );
  });

  it("auto-prompt surfaces the card once for a fresh auto_prompt proposal", () => {
    const { result, buildSummary } = setup({
      presentation: "auto_prompt",
      isFreshCompletion: true,
      proposedAction: "word.apply_edits",
    });
    expect(result.current.confirmCard).toMatchObject({
      action: "word.apply_edits",
      autoTriggered: true,
    });
    expect(buildSummary).toHaveBeenCalledTimes(1);
  });

  it("auto-prompt executes directly under a stored always-allow", () => {
    const { result, execute } = setup({
      presentation: "auto_prompt",
      isFreshCompletion: true,
      proposedAction: "word.apply_edits",
      decisions: { "word_edit_selection/word.apply_edits": "always" },
    });
    expect(execute).toHaveBeenCalledWith("word.apply_edits");
    expect(result.current.confirmCard).toBeNull();
  });

  it("auto-prompt never fires for history messages or a different open item", () => {
    const history = setup({
      presentation: "auto_prompt",
      isFreshCompletion: false,
      proposedAction: "word.apply_edits",
    });
    expect(history.result.current.confirmCard).toBeNull();

    const otherItem = setup({
      presentation: "auto_prompt",
      isFreshCompletion: true,
      proposedAction: "word.apply_edits",
      currentItemIdentity: "doc-2",
    });
    expect(otherItem.result.current.confirmCard).toBeNull();
    expect(otherItem.execute).not.toHaveBeenCalled();
  });

  it("consumes the once-per-message slot per scope, so a remount cannot re-prompt", () => {
    const messageId = freshMessageId();
    const first = setup({
      messageId,
      presentation: "auto_prompt",
      isFreshCompletion: true,
      proposedAction: "word.apply_edits",
    });
    expect(first.result.current.confirmCard).not.toBeNull();
    first.unmount();

    const remount = setup({
      messageId,
      presentation: "auto_prompt",
      isFreshCompletion: true,
      proposedAction: "word.apply_edits",
    });
    expect(remount.result.current.confirmCard).toBeNull();
  });
});
