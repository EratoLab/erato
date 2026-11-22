import { describe, expect, it } from "vitest";

import {
  wordPartSourceIndexes,
  wordPartsLayout,
  wordPartsPlanningCall,
  wordPartsProgress,
  wordPartsReorders,
  wordPartsSectionPlanCall,
} from "../wordPartsProgress";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

type Row = { source: string; action: string; title?: string };

const tool = (
  id: string,
  name: string,
  status: string,
  input: unknown,
  output?: unknown,
) =>
  ({
    content_type: "tool_use",
    tool_call_id: id,
    tool_name: name,
    status,
    input,
    output: output ?? null,
  }) as unknown as ContentPart;

function sectionPlan(
  rows: Row[],
  titles: string[],
  {
    id = "plan",
    status = (r: Row): string =>
      r.action === "rewrite"
        ? "waiting"
        : r.action === "delete"
          ? "deleted"
          : "kept",
  }: { id?: string; status?: (r: Row) => string } = {},
) {
  return tool(
    id,
    "plan_document_sections",
    "success",
    { snapshot: "s", readToken: "t", intent: "Plain wording.", rows },
    {
      status: "success",
      result: {
        draft_id: "draft-1",
        revision: 1,
        rows: rows.map((row, k) => ({
          row: k + 1,
          action: row.action,
          title: titles[k],
          ...(row.title ? { new_title: row.title } : {}),
          paragraphs: 1,
          status: status(row),
        })),
      },
    },
  );
}

const accepted = (id: string, row: number) =>
  tool(
    id,
    "write_document_section",
    "success",
    { snapshot: "s", draft_id: "draft-1", row, ops: [] },
    {
      status: "success",
      result: { draft_id: "draft-1", revision: 2, row, status: "ready" },
      part: { tries_remaining: 2, calls_remaining: 30 },
    },
  );

const SIX: Row[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  source: `b${n * 10 - 9}-b${n * 10}`,
  action: "rewrite",
}));
const SIX_TITLES = SIX.map((_, k) => `§ ${k + 1} Section ${k + 1}`);

describe("the parts card's rows", () => {
  it("shows every row of a six-section plan as soon as the plan is accepted", () => {
    const content = [sectionPlan(SIX, SIX_TITLES)];
    const progress = wordPartsProgress(content, true)!;
    expect(wordPartsSectionPlanCall(content)).toBe("plan");
    expect(progress.rows.map((row) => [row.title, row.state])).toEqual(
      SIX_TITLES.map((title) => [title, "writing"]),
    );
    expect(progress).toMatchObject({
      callId: "plan",
      intent: "Plain wording.",
      stopped: false,
    });
    expect(progress.structure).toBeUndefined();
  });

  it("shows a row writing until a part for it is accepted, a quiet fix included", () => {
    const content = [
      sectionPlan(SIX, SIX_TITLES),
      accepted("p1", 1),
      tool("p2", "write_document_section", "error", {
        snapshot: "s",
        draft_id: "draft-1",
        row: 2,
        ops: [],
      }),
      tool("p3", "write_document_section", "in_progress", {
        snapshot: "s",
        draft_id: "draft-1",
        row: 3,
        ops: [],
      }),
      tool(
        "p4",
        "write_document_section",
        "preparing",
        '{"snapshot":"s","draft_id":"draft-1","row":4,"ops":[{"keep":"b31',
      ),
    ];
    const states = (generating: boolean) =>
      wordPartsProgress(content, generating)!.rows.map((row) => row.state);
    expect(states(true)).toEqual([
      "ready",
      "writing",
      "writing",
      "writing",
      "writing",
      "writing",
    ]);
    expect(states(false)).toEqual([
      "ready",
      "not-written",
      "not-written",
      "not-written",
      "not-written",
      "not-written",
    ]);
    expect(wordPartsProgress(content, false)!.stopped).toBe(true);
  });

  it("keeps a row ready when a resend of it is refused", () => {
    const resend = tool("p1b", "write_document_section", "error", {
      snapshot: "s",
      draft_id: "draft-1",
      row: 1,
      ops: [],
    });
    const content = [sectionPlan(SIX, SIX_TITLES), accepted("p1", 1), resend];
    expect(wordPartsProgress(content, true)!.rows[0].state).toBe("ready");
    expect(wordPartsProgress(content, false)!.rows[0].state).toBe("ready");
  });

  it("names the moves, merges and renames of the structure by the rows' own titles", () => {
    const rows: Row[] = [
      { source: "b1-b10", action: "keep" },
      { source: "b31-b40", action: "keep", title: "§ 2 Lagerung" },
      { source: "b21-b30", action: "rewrite" },
      { source: "b11-b20", action: "keep", title: "§ 4 Abnahme" },
      { source: "b41-b45,b51-b55", action: "rewrite" },
      { source: "b46-b50", action: "delete" },
      { source: "b56-b60", action: "keep" },
    ];
    const titles = [
      "§ 1 Gegenstand",
      "§ 4 Lagerung",
      "§ 3 Lieferung",
      "§ 2 Abnahme",
      "§ 5 Haftung, § 7 Gewährleistung",
      "§ 6 Sonstiges",
      "§ 8 Schluss",
    ];
    const progress = wordPartsProgress([sectionPlan(rows, titles)], true)!;
    expect(progress.rows.map((row) => [row.title, row.state])).toEqual([
      ["§ 3 Lieferung", "writing"],
      ["§ 5 Haftung, § 7 Gewährleistung", "writing"],
      ["§ 6 Sonstiges", "ready"],
    ]);
    expect(progress.structure).toEqual({
      moves: [
        { row: 2, title: "§ 4 Lagerung", after: "§ 1 Gegenstand" },
        { row: 3, title: "§ 3 Lieferung", after: "§ 2 Lagerung" },
      ],
      merges: [{ row: 5, title: "§ 5 Haftung, § 7 Gewährleistung" }],
      renames: [
        { row: 2, title: "§ 4 Lagerung", newTitle: "§ 2 Lagerung" },
        { row: 4, title: "§ 2 Abnahme", newTitle: "§ 4 Abnahme" },
      ],
    });
  });

  it("takes the finish receipt's word for rows not written, changed in Word or left out by the checks", () => {
    const finish = tool(
      "finish",
      "submit_document_plan",
      "success",
      {
        snapshot: "s",
        readToken: "t",
        draft_id: "draft-1",
        revision: 4,
        finish: true,
      },
      {
        status: "success",
        submission: { status: "accepted" },
        result: {
          draft_id: "finish",
          snapshot: "s",
          action: "word.apply_document_plan",
          rows: SIX.map((_, k) => ({
            row: k + 1,
            action: "rewrite",
            title: SIX_TITLES[k],
            paragraphs: 10,
            status:
              k === 1
                ? "changed_in_word"
                : k === 3
                  ? "left_out"
                  : k === 5
                    ? "not_written"
                    : "ready",
          })),
        },
      },
    );
    const content = [
      sectionPlan(SIX, SIX_TITLES),
      ...[1, 2, 3, 4, 5].map((row) => accepted(`p${row}`, row)),
      finish,
    ];
    const progress = wordPartsProgress(content, false)!;
    expect(progress.finished).toBe("finish");
    expect(progress.stopped).toBe(false);
    expect(progress.rows.map((row) => row.state)).toEqual([
      "ready",
      "changed-in-word",
      "ready",
      "left-out",
      "ready",
      "not-written",
    ]);
  });

  it("reads a delete row and a rename the finish left out as changed in Word, and drops them from the structure", () => {
    const rows: Row[] = [
      { source: "b1-b10", action: "rewrite" },
      { source: "b11-b20", action: "keep", title: "§ 2 Services" },
      { source: "b21-b30", action: "delete" },
      { source: "b31-b35,b41-b45", action: "rewrite" },
      { source: "b36-b40", action: "keep" },
      { source: "b46-b50", action: "rewrite" },
    ];
    const titles = [
      "§ 1 Gegenstand",
      "§ 2 Leistungen",
      "§ 3 Haftung",
      "§ 4 Preise, § 6 Zahlung",
      "§ 5 Lieferung",
      "§ 7 Schluss",
    ];
    const statuses = [
      "ready",
      "changed_in_word",
      "changed_in_word",
      "ready",
      "kept",
      "ready",
    ];
    const finishOf = (status: (k: number) => string, extra = {}) =>
      tool(
        "finish",
        "submit_document_plan",
        "success",
        {
          snapshot: "s",
          readToken: "t",
          draft_id: "draft-1",
          revision: 4,
          finish: true,
        },
        {
          status: "success",
          submission: { status: "accepted" },
          result: {
            draft_id: "finish",
            snapshot: "s",
            action: "word.apply_document_plan",
            rows: rows.map((row, k) => ({
              row: k + 1,
              action: row.action,
              title: titles[k],
              ...(row.title ? { new_title: row.title } : {}),
              paragraphs: 5,
              status: status(k),
            })),
            ...extra,
          },
        },
      );
    const content = [
      sectionPlan(rows, titles),
      accepted("p1", 1),
      accepted("p4", 4),
      accepted("p6", 6),
      finishOf((k) => statuses[k]),
    ];
    const progress = wordPartsProgress(content, false)!;
    expect(progress.rows.map((row) => [row.title, row.state])).toEqual([
      ["§ 1 Gegenstand", "ready"],
      ["§ 3 Haftung", "changed-in-word"],
      ["§ 4 Preise, § 6 Zahlung", "ready"],
      ["§ 7 Schluss", "ready"],
    ]);
    expect(progress.structure).toEqual({
      moves: [],
      merges: [{ row: 4, title: "§ 4 Preise, § 6 Zahlung" }],
      renames: [],
    });
    expect(progress.reorderingLeftOut).toBeUndefined();
    expect(wordPartsReorders(progress)).toBe(true);

    const mergeKept = wordPartsProgress(
      [
        ...content.slice(0, -1),
        finishOf((k) => (k === 3 ? "changed_in_word" : statuses[k]), {
          reordering: "changed_in_word",
        }),
      ],
      false,
    )!;
    expect(mergeKept.structure?.merges).toEqual([]);
    expect(mergeKept.structure?.moves).toHaveLength(1);
    expect(mergeKept.reorderingLeftOut).toBe("changed_in_word");
    expect(wordPartsReorders(mergeKept)).toBe(false);
  });

  it("follows only the latest section plan", () => {
    const replanned = sectionPlan(SIX.slice(0, 2), SIX_TITLES.slice(0, 2), {
      id: "plan-2",
      status: (row) => (row.source === "b1-b10" ? "ready" : "waiting"),
    });
    const content = [
      sectionPlan(SIX, SIX_TITLES),
      accepted("p1", 1),
      accepted("p3", 3),
      replanned,
      tool(
        "finish",
        "submit_document_plan",
        "preparing",
        '{"snapshot":"s","readToken":"t","draft_id":"draft-1","revision":3,"finish":true}',
      ),
    ];
    const progress = wordPartsProgress(content, true)!;
    expect(progress.callId).toBe("plan-2");
    expect(progress.rows.map((row) => row.state)).toEqual(["ready", "writing"]);
  });

  it("names the section plan Erato is writing until one is accepted", () => {
    const writing = tool(
      "plan",
      "plan_document_sections",
      "preparing",
      '{"snapshot":"s","readToken":"t","intent":"Plain',
    );
    expect(wordPartsPlanningCall([writing], true)).toBe("plan");
    expect(wordPartsPlanningCall([writing], false)).toBeUndefined();
    const refused = tool("plan", "plan_document_sections", "error", {}, {});
    const again = tool("plan-2", "plan_document_sections", "in_progress", {});
    expect(wordPartsPlanningCall([refused, again], true)).toBe("plan-2");
    expect(
      wordPartsPlanningCall([sectionPlan(SIX, SIX_TITLES), again], true),
    ).toBeUndefined();
  });

  it("is absent without an accepted section plan", () => {
    const refused = tool(
      "plan",
      "plan_document_sections",
      "error",
      {},
      {
        status: "error",
        validation_errors: [],
      },
    );
    expect(wordPartsProgress([refused], true)).toBeUndefined();
    expect(wordPartsSectionPlanCall([refused])).toBeUndefined();
  });
});

describe("the section plan's layout", () => {
  it("counts the probe's two moves and no move for a delete row or an adjacent merge", () => {
    const rows = [
      "b1-b98",
      "b179-b214",
      "b99-b143",
      "b144-b178",
      "b350-b380",
      "b215-b306",
      "b307-b349",
      "b381-b422",
    ].map((source) => ({
      action: "rewrite",
      refs: wordPartSourceIndexes(source)!,
    }));
    expect(wordPartsLayout(rows)).toEqual({
      moved: [1, 4],
      merged: [],
      renamed: [],
    });
    expect(
      wordPartsLayout([
        { action: "delete", refs: [9] },
        { action: "keep", refs: [0, 1] },
        { action: "rewrite", refs: [2, 3, 4] },
      ]).moved,
    ).toEqual([]);
  });

  it("keeps a merge of neighbouring sections out of the reordering", () => {
    expect(
      wordPartsLayout([
        { action: "keep", refs: wordPartSourceIndexes("b1-b240")! },
        {
          action: "rewrite",
          refs: wordPartSourceIndexes("b241-b260,b261-b290")!,
        },
        { action: "keep", refs: wordPartSourceIndexes("b291-b300")! },
      ]),
    ).toEqual({ moved: [], merged: [], renamed: [] });
  });

  it("reads refs and ranges and refuses anything else", () => {
    expect(wordPartSourceIndexes("b2-b4, b7")).toEqual([1, 2, 3, 6]);
    expect(wordPartSourceIndexes("b4–b5")).toEqual([3, 4]);
    expect(wordPartSourceIndexes("b4-b2")).toBeUndefined();
    expect(wordPartSourceIndexes("t1")).toBeUndefined();
    expect(wordPartSourceIndexes(3)).toBeUndefined();
  });
});
