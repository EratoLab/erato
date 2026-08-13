import { ThemeProvider } from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildTeamsTranscriptFile } from "../../utils/buildTeamsTranscriptFile";
import { TeamsAttachmentsPreview } from "../TeamsAttachmentsPreview";

import type { TeamsTranscriptSection } from "../../utils/buildTeamsTranscriptFile";
import type { ParsedTeamsMessage } from "../../utils/parsedTeamsChat";
import type {
  FileAttachmentsPreviewProps,
  FileUploadItem,
} from "@erato/frontend/library";

const state = vi.hoisted(() => ({
  attachedTranscript: null as File | null,
}));

vi.mock("../../providers/TeamsChatPickerProvider", () => ({
  useTeamsChatPicker: () => ({ attachedTranscript: state.attachedTranscript }),
}));

function upload(filename: string, id = filename): FileUploadItem {
  return { id, filename } as FileUploadItem;
}

const transcript = upload("teams-Product_sync.md", "upload-transcript");
const image = upload("teams-img-abc.png", "upload-image");
const report = upload("teams-file-abc12345-Q3_report.pdf", "upload-report");
const unrelated = upload("holiday.pdf", "upload-holiday");

function message(
  overrides: Partial<ParsedTeamsMessage> = {},
): ParsedTeamsMessage {
  const messageId = overrides.messageId ?? "m1";
  return {
    chatId: "19:chat",
    messageId,
    senderName: "Ada Lovelace",
    createdAt: "2026-03-01T08:00:00Z",
    editedAt: null,
    subject: null,
    text: "Screenshot [image: teams-img-abc.png]",
    markers: [],
    sharedFiles: [],
    imageUrls: [],
    replyToId: null,
    deepLink: `https://teams.microsoft.com/l/message/19:chat/${messageId}`,
    ...overrides,
  };
}

/**
 * A fresh file per call: the read of a transcript is cached by file identity,
 * so a shared one would answer later tests without ever being read.
 */
function transcriptFile(
  selection: TeamsTranscriptSection["selection"] = "messages",
  messages: ParsedTeamsMessage[] = [message()],
): File {
  const file = buildTeamsTranscriptFile({
    sections: [
      {
        kind: "chat",
        chat: {
          chatId: "19:chat",
          title: "Product sync",
          participants: [],
          selfDisplayName: null,
          participantsTruncated: false,
          chatType: "group",
          lastActivityAt: null,
          previewText: "",
        },
        messages,
        selection,
      },
    ],
    timeZone: "UTC",
  });
  if (!file) throw new Error("expected a transcript");
  return file;
}

function renderPreview(
  attachedFiles: FileUploadItem[],
  overrides: Partial<FileAttachmentsPreviewProps> = {},
) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider
        enableCustomTheme={false}
        initialThemeMode="light"
        persistThemeMode={false}
      >
        <TeamsAttachmentsPreview
          attachedFiles={attachedFiles}
          maxFiles={50}
          onRemoveFile={() => {}}
          onRemoveAllFiles={() => {}}
          {...overrides}
        />
      </ThemeProvider>
    </I18nProvider>,
  );
}

const groupHeader = () => screen.getByRole("button", { name: /product sync/i });

/** Carries a shared file, so its chip has a real name rather than a macro. */
const sharedFileMessage = message({
  text: "Numbers attached",
  markers: ["[attachment: teams-file-abc12345-Q3_report.pdf]"],
  sharedFiles: [
    {
      attachmentId: "a1",
      name: "Q3 report.pdf",
      contentUrl: "https://contoso.sharepoint.com/Q3.pdf",
    },
  ],
});

describe("TeamsAttachmentsPreview", () => {
  beforeEach(() => {
    i18n.load("en", {});
    i18n.activate("en");
    state.attachedTranscript = null;
  });
  afterEach(cleanup);

  it("renders the composer's flat chips when no transcript is attached", () => {
    renderPreview([unrelated]);

    expect(screen.queryByRole("button", { name: /product sync/i })).toBeNull();
    expect(screen.getByText("holiday")).toBeVisible();
  });

  it("renders the conversation out of the transcript's own index block", async () => {
    state.attachedTranscript = transcriptFile();
    // Nothing is mounted until the block parses: showing the flat chips first
    // and pulling them back out a frame later is worse than a blank region.
    expect(screen.queryByText("holiday")).toBeNull();
    renderPreview([transcript, image, unrelated]);

    expect(await screen.findByText("Product sync")).toBeVisible();
    // The upload the transcript names is claimed by the conversation card; only
    // the unrelated file is left to the flat chips.
    expect(screen.getByText("holiday")).toBeVisible();
    expect(screen.queryByText("teams-img-abc")).toBeNull();
  });

  it("keeps a whole conversation collapsed so the composer stays reachable", async () => {
    state.attachedTranscript = transcriptFile("whole-chat");
    renderPreview([transcript, image]);

    await screen.findByText("Product sync");
    expect(groupHeader()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the conversation from the summary row", async () => {
    state.attachedTranscript = transcriptFile("whole-chat");
    renderPreview([transcript, image]);

    await screen.findByText("Product sync");
    fireEvent.click(groupHeader());
    // Matched on the row's own name, not the translated verb: this suite runs
    // without a message catalogue.
    fireEvent.click(screen.getByRole("button", { name: /all messages/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Ada Lovelace");
    expect(dialog).toHaveTextContent("Screenshot");
    // The marker the model reads is stripped, and the modal names the
    // conversation once — the view inside it does not repeat the heading.
    expect(dialog).not.toHaveTextContent("teams-img-abc");
    expect(dialog.querySelectorAll("h2")).toHaveLength(1);
  });

  it("previews an attachment from inside the conversation", async () => {
    const onFilePreview = vi.fn();
    state.attachedTranscript = transcriptFile("whole-chat", [
      sharedFileMessage,
    ]);
    renderPreview([transcript, report], { onFilePreview });

    await screen.findByText("Product sync");
    fireEvent.click(groupHeader());
    fireEvent.click(screen.getByRole("button", { name: /all messages/i }));

    // Matched on the file's own name: the surrounding "Preview attachment" is a
    // library string, and this suite runs without a catalogue.
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Q3 report/ }));
    expect(onFilePreview).toHaveBeenCalledWith(report);
  });

  it("names a shared file as Teams named it, never by its upload name", async () => {
    state.attachedTranscript = transcriptFile("whole-chat", [
      message({
        text: "Numbers attached",
        markers: ["[attachment: teams-file-abc12345-Q3_report.pdf]"],
        sharedFiles: [
          {
            attachmentId: "a1",
            name: "Q3 report.pdf",
            contentUrl: "https://contoso.sharepoint.com/Q3.pdf",
          },
        ],
      }),
    ]);
    renderPreview([transcript, report]);

    await screen.findByText("Product sync");
    fireEvent.click(groupHeader());

    expect(screen.getByText(/Q3 report/)).toBeVisible();
    expect(screen.queryByText(/teams-file-abc12345/)).toBeNull();
  });

  it("falls back to flat chips for a transcript with no index block", async () => {
    state.attachedTranscript = new File(
      ["# Teams chat: Product sync\n\nHello.\n"],
      transcript.filename,
      { type: "text/plain" },
    );
    renderPreview([transcript, image, unrelated]);

    expect(await screen.findByText("holiday")).toBeVisible();
    expect(screen.getByText("teams-Product_sync")).toBeVisible();
    expect(screen.queryByRole("button", { name: /product sync/i })).toBeNull();
  });

  it("falls back to flat chips when the index block is unreadable", async () => {
    state.attachedTranscript = new File(
      ['# Teams chat\n\n<!-- erato:teams-transcript v1 {"sections": -->\n'],
      transcript.filename,
      { type: "text/plain" },
    );
    renderPreview([transcript, image, unrelated]);

    expect(await screen.findByText("holiday")).toBeVisible();
    expect(screen.getByText("teams-Product_sync")).toBeVisible();
    expect(screen.queryByRole("button", { name: /product sync/i })).toBeNull();
  });
});
