import { i18n } from "@lingui/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildTeamsTranscriptFile } from "../../utils/buildTeamsTranscriptFile";
import { TeamsAttachmentsPreview } from "../TeamsAttachmentsPreview";

import type { TeamsTranscriptSection } from "../../utils/buildTeamsTranscriptFile";
import type { ParsedTeamsMessage } from "../../utils/parsedTeamsChat";
import type {
  FileAttachmentGroup,
  FileAttachmentsPreviewProps,
  FileUploadItem,
  GroupedFileAttachmentsPreviewProps,
} from "@erato/frontend/library";

const state = vi.hoisted(() => ({
  attachedTranscript: null as File | null,
}));

vi.mock("@erato/frontend/library", () => ({
  FileAttachmentsPreview: ({ attachedFiles }: FileAttachmentsPreviewProps) => (
    <div data-testid="flat-preview">
      {attachedFiles.map((file) => file.filename).join(",")}
    </div>
  ),
  GroupedFileAttachmentsPreview: ({
    groups,
  }: GroupedFileAttachmentsPreviewProps) => (
    <div data-testid="grouped-preview">
      {groups.map((group: FileAttachmentGroup) => (
        <div key={group.id} data-testid="group">
          {group.label}
          <span data-testid="group-items">
            {group.items.map((item) => item.kind).join(",")}
          </span>
        </div>
      ))}
    </div>
  ),
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
        messages: [message()],
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
    <TeamsAttachmentsPreview
      attachedFiles={attachedFiles}
      maxFiles={50}
      onRemoveFile={() => {}}
      onRemoveAllFiles={() => {}}
      {...overrides}
    />,
  );
}

describe("TeamsAttachmentsPreview", () => {
  beforeEach(() => {
    i18n.activate("en");
    state.attachedTranscript = null;
  });
  afterEach(cleanup);

  it("renders the composer's flat chips when no transcript is attached", () => {
    renderPreview([unrelated]);

    expect(screen.queryByTestId("grouped-preview")).toBeNull();
    expect(screen.getByTestId("flat-preview")).toHaveTextContent("holiday.pdf");
  });

  it("renders the conversation out of the transcript's own index block", async () => {
    state.attachedTranscript = transcriptFile();
    renderPreview([transcript, image, unrelated]);

    expect(await screen.findByTestId("group")).toHaveTextContent(
      "Product sync",
    );
    expect(screen.getByTestId("flat-preview")).toHaveTextContent("holiday.pdf");
    expect(screen.getByTestId("flat-preview")).not.toHaveTextContent(
      "teams-img-abc.png",
    );
  });

  it("waits for the block rather than flashing the flat chips first", async () => {
    state.attachedTranscript = transcriptFile();
    renderPreview([transcript, image, unrelated]);

    expect(screen.queryByTestId("flat-preview")).toBeNull();
    expect(screen.queryByTestId("grouped-preview")).toBeNull();
    await screen.findByTestId("grouped-preview");
  });

  it("expands hand-picked messages into a row each", async () => {
    state.attachedTranscript = transcriptFile("messages");
    renderPreview([transcript, image]);

    expect(await screen.findByTestId("group-items")).toHaveTextContent(
      "attachment,threadMessageGroup",
    );
  });

  it("collapses a whole conversation to its summary row", async () => {
    state.attachedTranscript = transcriptFile("whole-chat");
    renderPreview([transcript, image]);

    // The transcript row, then the image that rode along with the messages it
    // stands for — no per-message rows.
    expect(await screen.findByTestId("group-items")).toHaveTextContent(
      "attachment,attachment",
    );
  });

  it("falls back to flat chips for a transcript with no index block", async () => {
    state.attachedTranscript = new File(
      ["# Teams chat: Product sync\n\nHello.\n"],
      transcript.filename,
      { type: "text/plain" },
    );
    renderPreview([transcript, image, unrelated]);

    expect(await screen.findByTestId("flat-preview")).toHaveTextContent(
      "teams-Product_sync.md,teams-img-abc.png,holiday.pdf",
    );
    expect(screen.queryByTestId("grouped-preview")).toBeNull();
  });

  it("falls back to flat chips when the index block is unreadable", async () => {
    state.attachedTranscript = new File(
      ['# Teams chat\n\n<!-- erato:teams-transcript v1 {"sections": -->\n'],
      transcript.filename,
      { type: "text/plain" },
    );
    renderPreview([transcript, image, unrelated]);

    expect(await screen.findByTestId("flat-preview")).toHaveTextContent(
      "teams-Product_sync.md,teams-img-abc.png,holiday.pdf",
    );
    expect(screen.queryByTestId("grouped-preview")).toBeNull();
  });
});
