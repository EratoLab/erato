import { ThemeProvider } from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messages as frontendMessages } from "../../../../../frontend/src/locales/en/messages.po";
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

describe("TeamsAttachmentsPreview", () => {
  beforeEach(() => {
    i18n.load("en", frontendMessages);
    i18n.activate("en");
    state.attachedTranscript = null;
  });
  afterEach(cleanup);

  it("renders the composer's flat chips when the picker holds no transcript", () => {
    renderPreview([unrelated]);

    expect(screen.queryByRole("button", { name: /product sync/i })).toBeNull();
    expect(screen.getByText("holiday.pdf")).toBeVisible();
  });

  it("renders the picker's transcript as its conversation", async () => {
    state.attachedTranscript = transcriptFile();
    renderPreview([transcript, image, unrelated]);

    expect(await screen.findByText("Product sync")).toBeVisible();
    expect(screen.getByText("holiday.pdf")).toBeVisible();
    expect(screen.queryByText("teams-img-abc")).toBeNull();
  });

  it("opens the conversation from the summary row", async () => {
    state.attachedTranscript = transcriptFile("whole-chat");
    renderPreview([transcript, image]);

    await screen.findByText("Product sync");
    fireEvent.click(groupHeader());
    // The trailing comma picks the activate button over the remove button,
    // which carries the same name.
    fireEvent.click(screen.getByRole("button", { name: /all messages,/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Ada Lovelace");
    expect(dialog).toHaveTextContent("Screenshot");
  });
});
