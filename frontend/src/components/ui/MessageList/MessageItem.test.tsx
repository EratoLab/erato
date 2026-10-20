import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import {
  registerSentWithDescriptors,
  resetSentWithDescriptors,
} from "@/utils/chat/sentWith";

import { MessageEditProvider } from "./MessageEditContext";
import { MessageItem } from "./MessageItem";

import type { MessageEditContextValue } from "./MessageEditContext";
import type { ChatInputTokenUsage } from "@/components/ui/Chat/ChatInputTokenUsage";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";
import type { ComponentProps } from "react";

const tokenUsage = vi.hoisted(() => vi.fn((_props: unknown) => null));

vi.mock("@/components/ui/Chat/ChatInputTokenUsage", () => ({
  ChatInputTokenUsage: (props: unknown) => tokenUsage(props),
}));

const notes = {
  id: "file-1",
  filename: "notes.pdf",
  download_url: "https://example.invalid/notes.pdf",
} as FileUploadItem;

const message = {
  id: "u1",
  role: "user",
  status: "complete",
  createdAt: "2026-07-20T00:00:00Z",
  content: [{ content_type: "text", text: "original text" }],
  input_files_ids: ["file-1"],
  previous_message_id: "a0",
  action_facet_id: "word_document_review",
  action_facet_args: { document_name: "Supply agreement.docx" },
  files: [notes],
} as Message & { files: FileUploadItem[] };

const editValue: MessageEditContextValue = {
  editingMessageId: "u1",
  beginEdit: vi.fn(),
  cancelEdit: vi.fn(),
  submitEdit: vi.fn(),
  chatId: "chat-1",
  assistantId: "assistant-1",
  chatProviderId: "provider-1",
};

const lastTokenProps = () =>
  tokenUsage.mock.calls.at(-1)?.[0] as ComponentProps<
    typeof ChatInputTokenUsage
  >;

const renderRow = (value: MessageEditContextValue = editValue) =>
  render(
    <ThemeProvider
      enableCustomTheme={false}
      initialThemeMode="light"
      persistThemeMode={false}
    >
      <MessageEditProvider value={value}>
        <MessageItem
          messageId="u1"
          message={message}
          isNew={false}
          controlsContext={{}}
          onMessageAction={vi.fn(async () => true)}
          allFilesById={{ [notes.id]: notes }}
        />
      </MessageEditProvider>
    </ThemeProvider>,
  );

describe("MessageItem while its message is edited", () => {
  afterEach(() => {
    resetSentWithDescriptors();
    tokenUsage.mockClear();
  });

  it("checks tokens on the editor's current files and the facet it sends again", () => {
    registerSentWithDescriptors({
      word_document_review: (args) => [
        {
          id: "word.document",
          kind: "word.document",
          icon: "document",
          label: args.document_name,
        },
      ],
    });
    renderRow();

    expect(lastTokenProps()).toMatchObject({
      message: "original text",
      chatId: "chat-1",
      assistantId: "assistant-1",
      previousMessageId: "a0",
      chatProviderId: "provider-1",
    });
    expect(lastTokenProps().attachedFiles.map((file) => file.id)).toEqual([
      "file-1",
    ]);
    expect(lastTokenProps().virtualFiles?.map((file) => file.name)).toEqual([
      "word_document_review.txt",
    ]);

    fireEvent.click(screen.getByRole("button", { name: /remove notes/i }));

    expect(lastTokenProps().attachedFiles).toEqual([]);
    expect(lastTokenProps().virtualFiles?.map((file) => file.name)).toEqual([
      "word_document_review.txt",
    ]);
  });

  it("adds no estimate for a facet the server no longer offers", () => {
    registerSentWithDescriptors({
      word_document_review: (args) => [
        {
          id: "word.document",
          kind: "word.document",
          icon: "document",
          label: args.document_name,
        },
      ],
    });
    renderRow({ ...editValue, isActionFacetAvailable: () => false });

    expect(lastTokenProps().virtualFiles).toEqual([]);
    expect(lastTokenProps().attachedFiles.map((file) => file.id)).toEqual([
      "file-1",
    ]);
  });
});
