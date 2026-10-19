import { I18nProvider } from "@lingui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { messages as enMessages } from "@/locales/en/messages.json";
import {
  teamsIndex,
  teamsMessage,
  teamsSection,
  teamsTranscriptFile,
  textFile,
} from "@/test/teamsTranscriptFixtures";

import { TeamsAttachmentsPreview } from "./TeamsAttachmentsPreview";

import type { TeamsAttachmentsPreviewProps } from "./TeamsAttachmentsPreview";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type {
  TeamsTranscriptIndexMessage,
  TeamsTranscriptIndexSection,
} from "@/utils/teams/teamsTranscriptIndex";
import type { Messages } from "@lingui/core";

function upload(filename: string, id = filename): FileUploadItem {
  return { id, filename } as FileUploadItem;
}

const transcript = upload("teams-Product_sync.md", "upload-transcript");
const image = upload("teams-img-abc.png", "upload-image");
const report = upload("teams-file-abc12345-Q3_report.pdf", "upload-report");
const unrelated = upload("holiday.pdf", "upload-holiday");

const screenshot = teamsMessage("m1", {
  text: "Screenshot [image: teams-img-abc.png]",
  assets: [{ name: image.filename, displayName: null, kind: "image" }],
});

const sharedFileMessage = teamsMessage("m2", {
  text: "Numbers attached [attachment: teams-file-abc12345-Q3_report.pdf]",
  assets: [
    { name: report.filename, displayName: "Q3 report.pdf", kind: "file" },
  ],
});

/**
 * A fresh file per call: the read of a transcript is cached by file identity,
 * so a shared one would answer later tests without ever being read.
 */
function transcriptFile(
  section: Partial<TeamsTranscriptIndexSection> = {},
  messages: TeamsTranscriptIndexMessage[] = [screenshot],
): File {
  return teamsTranscriptFile(
    teamsIndex([teamsSection(section)], messages),
    transcript.filename,
  );
}

async function renderPreview(
  transcriptSource: File | null,
  attachedFiles: FileUploadItem[],
  overrides: Partial<TeamsAttachmentsPreviewProps> = {},
) {
  const { i18n } = await import("@lingui/core");
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");

  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider
        enableCustomTheme={false}
        initialThemeMode="light"
        persistThemeMode={false}
      >
        <TeamsAttachmentsPreview
          transcript={transcriptSource}
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

async function openWholeConversation() {
  await screen.findByText("Product sync");
  fireEvent.click(groupHeader());
  // The trailing comma picks the activate button over the remove button,
  // which carries the same name.
  fireEvent.click(screen.getByRole("button", { name: /all messages,/i }));
  return screen.findByRole("dialog");
}

describe("TeamsAttachmentsPreview", () => {
  afterEach(cleanup);

  it("renders the composer's flat chips when no transcript is attached", async () => {
    await renderPreview(null, [unrelated]);

    expect(screen.queryByRole("button", { name: /product sync/i })).toBeNull();
    expect(screen.getByText("holiday.pdf")).toBeVisible();
  });

  it("renders the conversation out of the transcript's own index block", async () => {
    await renderPreview(transcriptFile({ selection: "messages" }), [
      transcript,
      image,
      unrelated,
    ]);

    expect(await screen.findByText("Product sync")).toBeVisible();
    expect(screen.getByText("holiday.pdf")).toBeVisible();
    expect(screen.queryByText("teams-img-abc")).toBeNull();
  });

  it("keeps a whole conversation collapsed so the composer stays reachable", async () => {
    await renderPreview(transcriptFile(), [transcript, image]);

    await screen.findByText("Product sync");
    expect(groupHeader()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the conversation from the summary row", async () => {
    await renderPreview(transcriptFile(), [transcript, image]);

    const dialog = await openWholeConversation();
    expect(dialog).toHaveTextContent("Ada Lovelace");
    expect(dialog).toHaveTextContent("Screenshot");
    expect(dialog).not.toHaveTextContent("teams-img-abc");
    // The modal names the conversation once; the view inside does not repeat it.
    expect(dialog.querySelectorAll("h2")).toHaveLength(1);
  });

  it("previews an attachment from inside the conversation", async () => {
    const onFilePreview = vi.fn();
    await renderPreview(
      transcriptFile({}, [sharedFileMessage]),
      [transcript, report],
      { onFilePreview },
    );

    const dialog = await openWholeConversation();
    fireEvent.click(within(dialog).getByRole("button", { name: /Q3 report/ }));
    expect(onFilePreview).toHaveBeenCalledWith(report);
  });

  it("names a shared file as Teams named it, never by its upload name", async () => {
    await renderPreview(transcriptFile({}, [sharedFileMessage]), [
      transcript,
      report,
    ]);

    await screen.findByText("Product sync");
    fireEvent.click(groupHeader());

    expect(screen.getByText(/Q3 report/)).toBeVisible();
    expect(screen.queryByText(/teams-file-abc12345/)).toBeNull();
  });

  it("falls back to flat chips for a transcript with no index block", async () => {
    await renderPreview(
      textFile("# Teams chat: Product sync\n\nHello.\n", transcript.filename),
      [transcript, image, unrelated],
    );

    expect(await screen.findByText("holiday.pdf")).toBeVisible();
    expect(screen.getByText("teams-Product_sync.md")).toBeVisible();
    expect(screen.queryByRole("button", { name: /product sync/i })).toBeNull();
  });

  it("falls back to flat chips when the index block is unreadable", async () => {
    await renderPreview(
      textFile(
        '# Teams chat\n\n<!-- erato:teams-transcript v1 {"sections": -->\n',
        transcript.filename,
      ),
      [transcript, image, unrelated],
    );

    expect(await screen.findByText("holiday.pdf")).toBeVisible();
    expect(screen.getByText("teams-Product_sync.md")).toBeVisible();
    expect(screen.queryByRole("button", { name: /product sync/i })).toBeNull();
  });
});
