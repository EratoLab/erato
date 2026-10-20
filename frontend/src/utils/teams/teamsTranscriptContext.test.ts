import { i18n } from "@lingui/core";
import { afterEach, describe, expect, it } from "vitest";

import { messages as deMessages } from "@/locales/de/messages.json";
import { messages as enMessages } from "@/locales/en/messages.json";
import { messages as plMessages } from "@/locales/pl/messages.json";
import {
  teamsIndex,
  teamsMessage,
  teamsSection,
} from "@/test/teamsTranscriptFixtures";

import {
  formatTeamsTime,
  teamsTranscriptChipText,
  teamsTranscriptOtherFiles,
  teamsTranscriptSections,
} from "./teamsTranscriptContext";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

const activate = (locale: "de" | "en" | "pl") => {
  const catalogs = { de: deMessages, en: enMessages, pl: plMessages };
  i18n.load(locale, catalogs[locale] as unknown as Messages);
  i18n.activate(locale);
};

afterEach(() => activate("en"));

const upload = (filename: string, id = filename, size?: number) =>
  ({ id, filename, size }) as FileUploadItem & { size?: number };

const messages = (count: number, section = 0) =>
  Array.from({ length: count }, (_, position) =>
    teamsMessage(`s${section}m${position}`, { section }),
  );

describe("teamsTranscriptChipText", () => {
  it("names the first conversation and counts the rest", () => {
    const index = teamsIndex(
      [
        teamsSection(),
        teamsSection({ title: "Design review", kind: "channel" }),
        teamsSection({ title: "Grace Hopper" }),
      ],
      [...messages(120), ...messages(116, 1), ...messages(4, 2)],
    );
    expect(teamsTranscriptChipText(index, { reading: false })).toEqual({
      label: "Product sync +2",
      meta: "3 conversations · 240 messages",
      spokenLabel: "Teams transcript",
    });
  });

  it("never says +0", () => {
    const index = teamsIndex([teamsSection()], messages(1));
    expect(teamsTranscriptChipText(index, { reading: false })).toMatchObject({
      label: "Product sync",
      meta: "1 conversation · 1 message",
    });
  });

  it("says when it is reading and when it can't show the conversations", () => {
    expect(teamsTranscriptChipText(null, { reading: true })).toMatchObject({
      label: "Teams transcript",
      meta: "Reading transcript…",
    });
    expect(teamsTranscriptChipText(null, { reading: false })).toMatchObject({
      label: "Teams transcript",
      meta: "Conversations can't be shown",
    });
    expect(
      teamsTranscriptChipText(teamsIndex([], []), { reading: false }).meta,
    ).toBe("Conversations can't be shown");
  });

  it("counts in German and Polish", () => {
    activate("de");
    const three = teamsIndex(
      [teamsSection(), teamsSection(), teamsSection()],
      messages(240),
    );
    expect(teamsTranscriptChipText(three, { reading: false }).meta).toBe(
      "3 Unterhaltungen · 240 Nachrichten",
    );

    activate("pl");
    expect(teamsTranscriptChipText(three, { reading: false }).meta).toBe(
      "3 konwersacje · 240 wiadomości",
    );
    const five = teamsIndex(
      Array.from({ length: 5 }, () => teamsSection()),
      messages(1),
    );
    expect(teamsTranscriptChipText(five, { reading: false }).meta).toBe(
      "5 konwersacji · 1 wiadomość",
    );
  });
});

describe("teamsTranscriptSections", () => {
  const roadmap = upload(
    "teams-file-1a2b3c4d-roadmap-q1.pdf",
    "u-roadmap",
    1_153_434,
  );
  const screenshot = upload(
    "teams-img-0123456789abcdef.png",
    "u-shot",
    245_760,
  );

  it("describes each conversation: title, count and range, selection and kind", () => {
    const index = teamsIndex(
      [
        teamsSection({
          window: { from: "2026-10-01T12:00:00Z", to: "2026-10-14T12:00:00Z" },
        }),
        teamsSection({
          kind: "channel",
          title: "Design review",
          teamName: "Platform Team",
          truncated: true,
          skippedCount: 2,
        }),
        teamsSection({ title: "Grace Hopper", selection: "messages" }),
      ],
      [...messages(2), ...messages(1, 1), ...messages(1, 2)],
    );
    const [first, second, third] = teamsTranscriptSections(index, []);
    expect(first).toMatchObject({
      position: 0,
      title: "Product sync",
      meta: "2 messages · Oct 1, 2026 – Oct 14, 2026",
      selectionLine: "All messages · Chat",
      picked: [],
      files: [],
    });
    expect(second).toMatchObject({
      title: "Design review · Platform Team",
      kind: "channel",
      selectionLine:
        "Part of the conversation · 2 could not be loaded · Channel",
    });
    expect(third.selectionLine).toBe("Selected messages · Chat");
    expect(third.picked).toHaveLength(1);
  });

  it("lists picked messages with the viewer as You, a date and a short excerpt", () => {
    const long = "word ".repeat(40);
    const index = teamsIndex(
      [teamsSection({ selection: "messages", viewer: "Ada Lovelace" })],
      [
        teamsMessage("m1", {
          sender: "Grace Hopper",
          createdAt: "2026-10-10T12:20:00Z",
          text: "The vendor  wants\nthe signed copy",
        }),
        teamsMessage("m2", { text: long }),
      ],
    );
    const [section] = teamsTranscriptSections(index, []);
    expect(section.picked[0]).toMatchObject({
      key: "m1",
      sender: "Grace Hopper",
      excerpt: "The vendor wants the signed copy",
    });
    expect(section.picked[0].when).toContain("Oct 10, 2026");
    expect(section.picked[1].sender).toBe("You");
    expect(section.picked[1].excerpt).toHaveLength(100);
    expect(section.picked[1].excerpt.endsWith("…")).toBe(true);
  });

  it("formats dates in the app's language", () => {
    activate("de");
    const index = teamsIndex(
      [
        teamsSection({
          window: { from: "2026-10-01T12:00:00Z", to: "2026-10-14T12:00:00Z" },
        }),
      ],
      messages(1),
    );
    expect(teamsTranscriptSections(index, [])[0].meta).toBe(
      "1 Nachricht · 1. Okt. 2026 – 14. Okt. 2026",
    );
  });

  it("lists only staged uploads, under the names Teams gave them, each once", () => {
    const index = teamsIndex(
      [teamsSection(), teamsSection({ title: "Design review" })],
      [
        teamsMessage("m1", {
          assets: [
            {
              name: roadmap.filename,
              displayName: "roadmap-q1.pdf",
              kind: "file",
            },
            { name: screenshot.filename, displayName: null, kind: "image" },
            {
              name: "teams-file-ffffffff-gone.pdf",
              displayName: "gone.pdf",
              kind: "file",
            },
          ],
        }),
        teamsMessage("m2", {
          section: 1,
          assets: [
            {
              name: roadmap.filename,
              displayName: "roadmap-q1.pdf",
              kind: "file",
            },
          ],
        }),
      ],
    );
    const [first, second] = teamsTranscriptSections(index, [
      roadmap,
      screenshot,
      upload("holiday.pdf"),
    ]);
    expect(first.files).toEqual([
      { upload: roadmap, displayName: "roadmap-q1.pdf", isImage: false },
      { upload: screenshot, displayName: "Image", isImage: true },
    ]);
    expect(second.files).toEqual([]);
  });

  it("counts each section's files the composer did not take, once each", () => {
    const shared = {
      name: "teams-file-ffffffff-gone.pdf",
      displayName: "gone.pdf",
      kind: "file" as const,
    };
    const index = teamsIndex(
      [teamsSection(), teamsSection({ title: "Design review" })],
      [
        teamsMessage("m1", { assets: [shared] }),
        teamsMessage("m2", { assets: [shared] }),
        teamsMessage("m3", { section: 1 }),
      ],
    );
    const [first, second] = teamsTranscriptSections(index, [], [shared.name]);
    expect(first.notAttached).toBe(1);
    expect(second.notAttached).toBe(0);
  });

  it("keeps uploads no section names apart, named from the upload", () => {
    const roadmap = upload("teams-file-1a2b3c4d-roadmap-q1.pdf", "u-roadmap");
    const stray = upload("teams-img-0123456789abcdef.png", "u-stray");
    const index = teamsIndex(
      [teamsSection()],
      [
        teamsMessage("m1", {
          assets: [
            {
              name: roadmap.filename,
              displayName: "roadmap-q1.pdf",
              kind: "file",
            },
          ],
        }),
      ],
    );
    const sections = teamsTranscriptSections(index, [roadmap, stray]);
    expect(teamsTranscriptOtherFiles(sections, [roadmap, stray])).toEqual([
      { upload: stray, displayName: "Image.png", isImage: true },
    ]);
  });

  it("keeps two sections of one conversation apart", () => {
    const index = teamsIndex([teamsSection(), teamsSection()], []);
    const [first, second] = teamsTranscriptSections(index, []);
    expect(first.key).not.toBe(second.key);
  });
});

describe("formatTeamsTime", () => {
  it("reads in the app's language, not the browser's", () => {
    activate("de");
    expect(formatTeamsTime("2026-10-01T09:30:00Z")).toMatch(/^\d{2}:\d{2}$/);
    expect(formatTeamsTime(null)).toBeNull();
    expect(formatTeamsTime("not a date")).toBeNull();
  });
});
