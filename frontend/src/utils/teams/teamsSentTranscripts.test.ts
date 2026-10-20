import { describe, expect, it } from "vitest";

import {
  teamsIndex,
  teamsMessage,
  teamsSection,
} from "@/test/teamsTranscriptFixtures";

import { teamsSentTranscripts } from "./teamsSentTranscripts";

import type { TeamsTranscriptIndexRead } from "@/hooks/teams/useTeamsTranscriptIndex";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const upload = (id: string, filename: string) =>
  ({ id, filename }) as FileUploadItem;

const asset = (name: string) => ({
  name,
  displayName: null,
  kind: "file" as const,
});

const read = (names: string[]): TeamsTranscriptIndexRead => ({
  index: teamsIndex(
    [teamsSection()],
    [teamsMessage("m1", { assets: names.map(asset) })],
  ),
  isReading: false,
});

const READING: TeamsTranscriptIndexRead = { index: null, isReading: true };
const UNREADABLE: TeamsTranscriptIndexRead = { index: null, isReading: false };

const first = upload("t1", "teams-Product_sync.md");
const second = upload("t2", "teams-Design_review.md");
const report = upload("f1", "teams-file-abcd1234-report.pdf");
const chart = upload("f2", "teams-file-1234abcd-chart.png");
const own = upload("o1", "budget.xlsx");

const ids = (files: readonly FileUploadItem[]) => files.map((file) => file.id);

describe("teamsSentTranscripts", () => {
  it("places each asset under the transcript whose index names it", () => {
    const entries = teamsSentTranscripts(
      [first, second, report, chart, own],
      new Map([
        ["t1", read([report.filename])],
        ["t2", read([chart.filename])],
      ]),
    );
    expect(
      entries.map((entry) => [entry.transcript.id, ids(entry.assets)]),
    ).toEqual([
      ["t1", ["f1"]],
      ["t2", ["f2"]],
    ]);
  });

  it("claims an asset once when two transcripts name the same file", () => {
    const entries = teamsSentTranscripts(
      [first, second, report],
      new Map([
        ["t1", read([report.filename])],
        ["t2", read([report.filename])],
      ]),
    );
    expect(entries.map((entry) => ids(entry.assets))).toEqual([["f1"], []]);
  });

  it("claims the minted uploads by name while the transcript is read", () => {
    const entries = teamsSentTranscripts(
      [first, report, chart, own],
      new Map([["t1", READING]]),
    );
    expect(entries).toHaveLength(1);
    expect(ids(entries[0].assets)).toEqual(["f1", "f2"]);
    expect(entries[0].read.isReading).toBe(true);
  });

  it("keeps an unreadable transcript with minted uploads, and leaves one without them", () => {
    expect(
      teamsSentTranscripts([first, report], new Map([["t1", UNREADABLE]])).map(
        (entry) => ids(entry.assets),
      ),
    ).toEqual([["f1"]]);
    expect(
      teamsSentTranscripts([first, own], new Map([["t1", UNREADABLE]])),
    ).toEqual([]);
  });

  it("gives an unread transcript only the minted uploads no index named", () => {
    const entries = teamsSentTranscripts(
      [first, second, report, chart],
      new Map([
        ["t1", read([report.filename])],
        ["t2", READING],
      ]),
    );
    expect(entries.map((entry) => ids(entry.assets))).toEqual([["f1"], ["f2"]]);
  });

  it("finds nothing in a message without a transcript", () => {
    expect(teamsSentTranscripts([own, report], new Map())).toEqual([]);
  });
});
