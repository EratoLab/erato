import { i18n } from "@lingui/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../test/mocks/word/document";
import { WordAddinChat } from "../WordAddinChat";

import type {
  AddinChatController,
  AddinChatHostProps,
  AddinChatInputRenderProps,
} from "../../core/AddinChatCore";
import type { ReactNode } from "react";

const harness = vi.hoisted(() => {
  const hostCallbacksRef: { current: Record<string, unknown> } = {
    current: {},
  };
  const sends: unknown[][] = [];
  const messages: Record<string, unknown> = {};
  const messageOrder: string[] = [];
  const stampedMessages: { current: Record<string, unknown> } = { current: {} };
  return { hostCallbacksRef, sends, messages, messageOrder, stampedMessages };
});

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock({
    useFacets: () => ({
      data: {
        action_facets: [
          {
            id: "word_document_review",
            display_name: "Review this document",
            client_actions: ["word.apply_edits"],
            presentation: "auto_prompt",
          },
        ],
      },
    }),
  });
});

vi.mock("../../core/AddinChatInputCore", () => ({
  AddinChatInputCore: () => <div data-testid="word-composer" />,
}));
vi.mock("../../core/AddinSettingsDialogCore", () => ({
  AddinSettingsDialogCore: () => <div data-testid="word-settings" />,
}));

// Only the two members the Word host consumes are stubbed; everything else in
// that module is types, which are erased.
vi.mock("../../core/AddinChatCore", () => {
  const controller = {
    hostCallbacksRef: harness.hostCallbacksRef,
    chatInputControls: { addUploadedFiles: vi.fn() },
    uploadFiles: vi.fn(),
    acceptedFileTypes: [],
    isUploading: false,
    composerLocked: false,
    currentChatId: "chat-1",
    get messages() {
      return harness.messages;
    },
    get messageOrder() {
      return harness.messageOrder;
    },
  } as unknown as AddinChatController;

  return {
    AddinChatCore: ({
      Host,
    }: {
      Host: (props: AddinChatHostProps) => ReactNode;
    }) => <Host controller={controller} />,
    AddinChatCoreView: ({
      messages,
      renderInput,
      renderSettings,
    }: {
      messages?: Record<string, unknown>;
      renderInput: (props: AddinChatInputRenderProps) => ReactNode;
      renderSettings: (props: {
        isOpen: boolean;
        onClose: () => void;
      }) => ReactNode;
    }) => {
      harness.stampedMessages.current = messages ?? {};
      return (
        <div>
          {renderInput({
            chatId: "chat-1",
            onSendMessage: (...args: unknown[]) => harness.sends.push(args),
          } as unknown as AddinChatInputRenderProps)}
          {renderSettings({ isOpen: false, onClose: () => undefined })}
        </div>
      );
    },
  };
});

describe("WordAddinChatHost", () => {
  beforeEach(() => {
    i18n.activate("en");
    harness.hostCallbacksRef.current = {};
    harness.sends.length = 0;
    harness.messageOrder.length = 0;
    for (const key of Object.keys(harness.messages))
      delete harness.messages[key];
    harness.stampedMessages.current = {};
    installMockWordDocument([{ text: "Revenue grew." }]);
  });

  afterEach(() => {
    cleanup();
    uninstallMockWordDocument();
    vi.clearAllMocks();
  });

  it("registers all three host callbacks", () => {
    render(<WordAddinChat />);

    expect(typeof harness.hostCallbacksRef.current.beforeSend).toBe("function");
    expect(typeof harness.hostCallbacksRef.current.beforeEdit).toBe("function");
    expect(typeof harness.hostCallbacksRef.current.beforeRegenerate).toBe(
      "function",
    );
  });

  it("renders the Word composer with its chip, and the settings dialog", () => {
    render(<WordAddinChat />);

    expect(
      screen.getByTestId("word-include-document-chip"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("word-composer")).toBeInTheDocument();
    expect(screen.getByTestId("word-settings")).toBeInTheDocument();
  });

  it("stamps the host artifact onto an assistant reply to a Word facet", () => {
    harness.messages.u1 = {
      id: "u1",
      role: "user",
      action_facet_id: "word_document_review",
    };
    harness.messages.a1 = {
      id: "a1",
      role: "assistant",
      previous_message_id: "u1",
      content: [],
    };
    harness.messageOrder.push("u1", "a1");

    render(<WordAddinChat />);

    const stamped = harness.stampedMessages.current.a1 as {
      hostArtifact?: { cardFenceLanguages?: string[]; itemIdentity?: string };
    };
    expect(stamped.hostArtifact?.cardFenceLanguages).toEqual([
      "erato-word-edits",
      "erato-word-insert",
      "erato-word-document-plan",
    ]);
    // This pane never captured a send for it (history), so the write gate has
    // no identity to match and the card states why instead of guessing.
    expect(stamped.hostArtifact?.itemIdentity).toBeUndefined();
    // A user message is never stamped.
    expect(harness.stampedMessages.current.u1).not.toHaveProperty(
      "hostArtifact",
    );
  });

  it("stamps nothing when the reply came from no action facet", () => {
    harness.messages.u1 = { id: "u1", role: "user" };
    harness.messages.a1 = {
      id: "a1",
      role: "assistant",
      previous_message_id: "u1",
      content: [],
    };
    harness.messageOrder.push("u1", "a1");

    render(<WordAddinChat />);

    expect(harness.stampedMessages.current.a1).not.toHaveProperty(
      "hostArtifact",
    );
  });

  it("passes the pane's document identity down to the composer", () => {
    render(<WordAddinChat />);

    // The chip is keyed to the pane's document; the host mints the identity so
    // a document change can reset it.
    expect(screen.getByTestId("word-include-document-chip")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
