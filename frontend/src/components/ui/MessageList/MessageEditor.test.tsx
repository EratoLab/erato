import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { componentRegistry } from "@/config/componentRegistry";
import { server } from "@/lib/mocks/server";
import {
  teamsIndex,
  teamsMessage,
  teamsSection,
  teamsTranscriptText,
} from "@/test/teamsTranscriptFixtures";
import {
  registerSentWithDescriptors,
  resetSentWithDescriptors,
} from "@/utils/chat/sentWith";
import { forgetStoredTeamsTranscripts } from "@/utils/teams/storedTeamsTranscript";

import { MessageEditor } from "./MessageEditor";

import type {
  MessageEditorProps,
  MessageEditorTokenContext,
} from "./MessageEditor";
import type { ChatInputAttachmentPreviewProps } from "@/components/ui/FileUpload/FileAttachmentsPreview";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

const userMessage: Message = {
  id: "u1",
  role: "user",
  status: "complete",
  createdAt: "2026-07-20T00:00:00Z",
  content: [{ content_type: "text", text: "original text" }],
  input_files_ids: ["file-1"],
};

const attachedFile = {
  id: "file-1",
  filename: "notes.pdf",
  download_url: "https://example.invalid/notes.pdf",
} as MessageEditorProps["initialFiles"] extends (infer F)[] | undefined
  ? F
  : never;

const renderEditor = (overrides: Partial<MessageEditorProps> = {}) => {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <ThemeProvider
      enableCustomTheme={false}
      initialThemeMode="light"
      persistThemeMode={false}
    >
      <MessageEditor
        message={userMessage}
        onSubmit={onSubmit}
        onCancel={onCancel}
        initialFiles={[attachedFile]}
        {...overrides}
      />
    </ThemeProvider>,
  );
  return {
    onSubmit,
    onCancel,
    input: screen.getByTestId("message-editor-input"),
  };
};

describe("MessageEditor", () => {
  it("opens with the message's current text", () => {
    const { input } = renderEditor();

    expect(input).toHaveValue("original text");
  });

  it("submits the edited text and carries the message's files through", () => {
    const { onSubmit, input } = renderEditor();

    fireEvent.change(input, { target: { value: "edited text" } });
    fireEvent.click(screen.getByTestId("message-editor-submit"));

    expect(onSubmit).toHaveBeenCalledWith("edited text", ["file-1"]);
  });

  it("submits on Enter", () => {
    const { onSubmit, input } = renderEditor();

    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    expect(onSubmit).toHaveBeenCalledWith("original text", ["file-1"]);
  });

  it("keeps Shift+Enter as a newline rather than a submit", () => {
    const { onSubmit, input } = renderEditor();

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("cancels on Escape", () => {
    const { onCancel, input } = renderEditor();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not submit on the Enter that confirms an IME candidate", () => {
    const { onSubmit, input } = renderEditor();

    fireEvent.keyDown(input, { key: "Enter", keyCode: 229, isComposing: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not cancel on the Escape that dismisses an IME candidate", () => {
    const { onCancel, input } = renderEditor();

    fireEvent.keyDown(input, {
      key: "Escape",
      keyCode: 229,
      isComposing: true,
    });

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("blocks submit while a token limit is exceeded", () => {
    const { onSubmit, input } = renderEditor({ isSubmitBlocked: true });

    expect(screen.getByTestId("message-editor-submit")).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("drops a removed attachment from the submitted file ids", () => {
    const { onSubmit } = renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /remove|delete/i }));
    fireEvent.click(screen.getByTestId("message-editor-submit"));

    expect(onSubmit).toHaveBeenCalledWith("original text", []);
  });

  it("keeps Cancel usable while Submit is blocked", () => {
    const { onCancel } = renderEditor({ isSubmitBlocked: true });

    fireEvent.click(screen.getByTestId("message-editor-cancel"));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("blocks submit when the draft is emptied", () => {
    const { onSubmit, input } = renderEditor();

    fireEvent.change(input, { target: { value: "   " } });

    expect(screen.getByTestId("message-editor-submit")).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("draws the files in the shared lane, above the textarea", () => {
    const { input } = renderEditor();
    const editor = screen.getByTestId("message-editor");
    const area = editor.querySelector('[data-ui="composer-staged-area"]')!;

    expect(within(area as HTMLElement).getByText("notes.pdf")).toBeVisible();
    expect(
      area.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

const upload = (id: string, filename: string): FileUploadItem =>
  ({
    id,
    filename,
    download_url: `https://example.invalid/${id}`,
    file_contents_unavailable_missing_permissions: false,
    is_sharepoint_file: false,
  }) as FileUploadItem;

const live = () =>
  document.querySelector('[data-ui="composer-context-live"]')?.textContent ??
  "";

describe("MessageEditor context lane", () => {
  afterEach(() => {
    forgetStoredTeamsTranscripts();
    resetSentWithDescriptors();
    componentRegistry.ChatInputAttachmentPreview = null;
  });

  const transcript = upload("t1", "teams-Product_sync.md");
  const sharedFile = upload("f1", "teams-file-abcd1234-Q3_report.pdf");
  const sharedImage = upload("i1", "teams-img-0123456789abcdef.png");
  const ownFile = upload("o1", "budget.xlsx");
  const teamsFiles = [transcript, sharedFile, sharedImage, ownFile];

  const serveTranscript = (respond: () => Response | Promise<Response>) =>
    server.use(http.get("https://example.invalid/t1", respond));

  const storedTranscript = () =>
    teamsTranscriptText(
      teamsIndex(
        [teamsSection()],
        [
          teamsMessage("m1", {
            assets: [
              {
                name: sharedFile.filename,
                displayName: "Q3 report.pdf",
                kind: "file",
              },
              { name: sharedImage.filename, displayName: null, kind: "image" },
            ],
          }),
        ],
      ),
    );

  const transcriptChip = () =>
    document.querySelector<HTMLElement>(
      '[data-ui="composer-context-chip"][data-kind="teams.transcript"]',
    );

  it("shows a Teams transcript as one chip that stands for its files", async () => {
    serveTranscript(() => HttpResponse.text(storedTranscript()));
    const { onSubmit } = renderEditor({ initialFiles: teamsFiles });

    await waitFor(() =>
      expect(transcriptChip()).toHaveAttribute("data-state", "included"),
    );
    const files = document.querySelector('[data-ui="composer-staged-files"]')!;
    expect(within(files as HTMLElement).getByText("budget.xlsx")).toBeVisible();
    expect(
      within(files as HTMLElement).queryByText(/Q3_report|teams-/),
    ).toBeNull();
    expect(
      screen.getByRole("list", { name: "Attachments of this message" }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(transcriptChip()!).getByRole("button", {
        name: "Remove Teams transcript",
      }),
    );
    await waitFor(() => expect(transcriptChip()).toBeNull());
    expect(live()).toBe("Teams transcript removed, with 2 shared files.");
    fireEvent.click(screen.getByTestId("message-editor-submit"));
    expect(onSubmit).toHaveBeenCalledWith("original text", ["o1"]);
  });

  it("keeps a transcript that can't be read a chip over the files it brought", async () => {
    serveTranscript(() => new HttpResponse(null, { status: 404 }));
    renderEditor({ initialFiles: teamsFiles });

    expect(transcriptChip()).toHaveAttribute("data-state", "loading");
    await waitFor(() =>
      expect(transcriptChip()).toHaveAttribute("data-state", "included"),
    );
    expect(transcriptChip()).toHaveTextContent("Conversations can't be shown");
    const files = document.querySelector('[data-ui="composer-staged-files"]')!;
    expect(
      within(files as HTMLElement).queryByText(/teams-|Q3_report/),
    ).toBeNull();
  });

  it("hands a kit's attachment preview only the files no chip stands for", async () => {
    serveTranscript(() => HttpResponse.text(storedTranscript()));
    const seen: FileUploadItem[][] = [];
    componentRegistry.ChatInputAttachmentPreview = function KitFiles(
      props: ChatInputAttachmentPreviewProps,
    ) {
      seen.push(props.attachedFiles);
      return <div data-testid="kit-files">{props.attachedFiles.length}</div>;
    };
    renderEditor({ initialFiles: teamsFiles });

    await waitFor(() =>
      expect(transcriptChip()).toHaveAttribute("data-state", "included"),
    );
    expect(seen.at(-1)?.map((file) => file.id)).toEqual(["o1"]);
    expect(seen.every((files) => files.every((file) => file.id === "o1"))).toBe(
      true,
    );
  });

  describe("the facet the message was sent with", () => {
    const lockReason =
      "An edited message keeps the context it was sent with. To leave it out, write a new message.";
    const facetMessage: Message = {
      ...userMessage,
      action_facet_id: "word_selection",
      action_facet_args: { selected_text: "The Supplier shall deliver." },
    };

    const registerSelection = () =>
      registerSentWithDescriptors({
        word_selection: (args) => [
          {
            id: "word.selection",
            kind: "word.selection",
            icon: "selection",
            label: "“The Supplier shall …”",
            spokenLabel: "Selection",
            meta: "Selected passage",
            quote: args.selected_text,
          },
        ],
      });

    const facetChip = () =>
      document.querySelector<HTMLElement>(
        '[data-ui="composer-context-chip"][data-kind="word.selection"]',
      )!;

    it("shows it locked and sent as before, with a disabled (x) that says why", () => {
      registerSelection();
      renderEditor({ message: facetMessage });

      expect(facetChip()).toHaveAttribute("data-locked", "true");
      expect(facetChip()).toHaveAttribute("data-state", "included");
      expect(facetChip()).toHaveTextContent("Sent as before");
      const remove = facetChip().querySelector(
        '[data-ui="composer-context-remove"]',
      )!;
      expect(remove).toBeDisabled();
      expect(remove).toHaveAttribute("title", lockReason);

      const open = facetChip().querySelector<HTMLElement>(
        '[data-ui="composer-context-chip-open"]',
      )!;
      fireEvent.keyDown(open, { key: "Delete" });
      expect(live()).toBe(lockReason);
      expect(facetChip()).not.toBeNull();
    });

    it("opens a detail with the passage, and Escape there closes only the detail", () => {
      registerSelection();
      const { onCancel } = renderEditor({ message: facetMessage });
      const open = facetChip().querySelector<HTMLElement>(
        '[data-ui="composer-context-chip-open"]',
      )!;
      fireEvent.click(open);

      const dialog = screen.getByRole("dialog");
      expect(
        within(dialog).getByRole("blockquote", { name: "Selection" }),
      ).toHaveTextContent("The Supplier shall deliver.");
      expect(dialog).toHaveTextContent(lockReason);

      fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(onCancel).not.toHaveBeenCalled();
      expect(screen.getByTestId("message-editor")).toBeInTheDocument();

      fireEvent.keyDown(open, { key: "Escape" });
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    describe("in a narrow pane", () => {
      const original = window.matchMedia;
      afterEach(() => {
        window.matchMedia = original;
      });

      it("closes the sheet on Escape and keeps the edit open", () => {
        window.matchMedia = (query: string) => ({
          ...original(query),
          matches: query === "(max-width: 479.98px)",
        });
        registerSelection();
        const { onCancel } = renderEditor({ message: facetMessage });
        fireEvent.click(
          facetChip().querySelector<HTMLElement>(
            '[data-ui="composer-context-chip-open"]',
          )!,
        );
        const dialog = screen.getByRole("dialog");
        expect(dialog).toHaveAttribute("data-ui", "modal-shell");

        fireEvent.keyDown(document.activeElement ?? dialog, {
          key: "Escape",
        });
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(onCancel).not.toHaveBeenCalled();
      });
    });

    it("counts the facet and the current files in the token check", () => {
      registerSelection();
      const seen: MessageEditorTokenContext[] = [];
      renderEditor({
        message: facetMessage,
        renderTokenUsage: (_draft, context) => {
          seen.push(context);
          return null;
        },
      });

      expect(seen.at(-1)?.files.map((file) => file.id)).toEqual(["file-1"]);
      expect(seen.at(-1)?.virtualFiles.map((file) => file.name)).toEqual([
        "word_selection.txt",
      ]);

      fireEvent.click(screen.getByRole("button", { name: /remove notes/i }));
      expect(seen.at(-1)?.files).toEqual([]);
      expect(seen.at(-1)?.virtualFiles).toHaveLength(1);
    });

    it("shows no chip and counts nothing for a facet the server no longer offers", () => {
      registerSelection();
      const seen: MessageEditorTokenContext[] = [];
      renderEditor({
        message: facetMessage,
        isActionFacetAvailable: () => false,
        renderTokenUsage: (_draft, context) => {
          seen.push(context);
          return null;
        },
      });

      expect(
        document.querySelector('[data-ui="composer-context-chip"]'),
      ).toBeNull();
      expect(seen.at(-1)?.virtualFiles).toEqual([]);
    });
  });
});
