import { describe, expect, it } from "vitest";

import { normalizeWordDocumentPlan } from "../wordDocumentPlan";
import { editedParagraphCount, parseWordEdits } from "../wordEditPlan";
import {
  acceptedWordPlanFromHistory,
  isWordHistorySnapshot,
  wordEditOriginal,
  wordEditSourceFromHistory,
  wordHistoryProposal,
  wordHistoryProposalKey,
  wordMessageLineage,
  wordParagraphsFromDocumentText,
  wordPlanNotInProposal,
  wordSnapshotFromHistory,
  WORD_READ_TOOL,
} from "../wordHistory";
import {
  WORD_OUTLINE_HEADER,
  wordOutlineLine,
  wordOutlineOmission,
} from "../wordOutlineFormat";
import { buildWordPlanReview, wordPlanText } from "../wordPlanReview";
import earlierMessage from "./fixtures/history-earlier-message.json";
import edits from "./fixtures/history-edits.json";
import multiPage from "./fixtures/history-multi-page.json";
import noAccepted from "./fixtures/history-no-accepted.json";
import retryAccepted from "./fixtures/history-retry-accepted.json";

import type { WordDocumentPlan } from "../wordDocumentPlan";
import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

type Fixture = { messages: unknown[] };
const messagesOf = (fixture: Fixture) =>
  globalThis.structuredClone(fixture.messages) as Message[];
const toolUses = (message: Message) =>
  message.content.filter(
    (part): part is Extract<ContentPart, { content_type: "tool_use" }> =>
      part.content_type === "tool_use",
  );

const readPart = (
  blocks: Record<string, unknown>[],
  page: { cursor?: string; next?: string; total?: number } = {},
): ContentPart =>
  ({
    content_type: "tool_use",
    tool_name: WORD_READ_TOOL,
    tool_call_id: `read-${page.cursor ?? "first"}`,
    status: "success",
    input: { snapshot: "snap", cursor: page.cursor ?? null },
    output: {
      status: "success",
      result: {
        snapshot: "snap",
        scope: "body",
        blocks,
        ...(page.cursor
          ? {}
          : {
              styles: [{ id: "Normal", name: "Normal", type: "paragraph" }],
              fullDocument: false,
              assets: [],
              imageAssetIssues: [],
              preservedStories: [],
            }),
        blocksTotal: page.total ?? 1,
        nextCursor: page.next ?? null,
        complete: !page.next,
        ...(page.next ? {} : { readToken: "read-proof" }),
      },
    },
  }) as unknown as ContentPart;

describe("Word plans restored from chat history", () => {
  it("rebuilds the read and keeps only the accepted attempt of a retried submission", () => {
    const [user, assistant] = messagesOf(retryAccepted);
    const statuses = toolUses(assistant).map(
      (part) =>
        (part.output as unknown as { submission?: { status: string } } | null)
          ?.submission?.status,
    );
    expect(statuses).toEqual([undefined, "retry", "accepted"]);
    const accepted = acceptedWordPlanFromHistory(assistant.content);
    expect(accepted?.toolCallId).toBe(toolUses(assistant)[2].tool_call_id);
    const snapshot = wordSnapshotFromHistory(
      [user, assistant],
      accepted!.plan.snapshot,
    );
    expect(isWordHistorySnapshot(snapshot)).toBe(true);
    expect(snapshot).toMatchObject({
      source: "history",
      revoked: true,
      used: true,
      fullDocument: true,
      readToken: accepted!.plan.readToken,
    });
    expect(snapshot!.blocks.map((b) => b.ref)).toEqual(
      Array.from({ length: 10 }, (_, i) => `b${i + 1}`),
    );
    expect(snapshot!.blocks[1]).toMatchObject({
      type: "list-item",
      list: "existing-1",
      ordered: true,
      xml: "",
    });
    expect(snapshot!.sections).toHaveLength(1);
    expect(snapshot!.sections![0].layout).toMatchObject({
      orientation: "portrait",
    });
    expect(snapshot!.styles.length).toBeGreaterThan(0);
    const review = buildWordPlanReview(accepted!.plan, snapshot);
    expect(review.riskUnknown).toBe(false);
    expect(review.scope.wholeFile).toBe(true);
  });

  it("finds the read in an earlier message of the branch, after a restarted first page", () => {
    const messages = messagesOf(earlierMessage);
    const [, first, , retry] = messages;
    const read = toolUses(first).find((p) => p.tool_name === WORD_READ_TOOL)!;
    const result = (
      read.output as unknown as { result: Record<string, unknown> }
    ).result;
    expect(result.snapshotRecovery).toMatchObject({ restarted: true });
    const snapshotId = (
      toolUses(retry)[0].input as unknown as { snapshot: string }
    ).snapshot;
    expect(result.snapshot).toBe(snapshotId);
    expect(acceptedWordPlanFromHistory(retry.content)).toBeUndefined();
    const byId = Object.fromEntries(messages.map((m) => [m.id, m]));
    const lineage = wordMessageLineage(byId, retry.id);
    expect(lineage.map((m) => m.id)).toEqual(messages.map((m) => m.id));
    const snapshot = wordSnapshotFromHistory(lineage, snapshotId);
    expect(snapshot?.fullDocument).toBe(true);
    expect(snapshot?.blocks.length).toBeGreaterThan(0);
    expect(wordSnapshotFromHistory([retry], snapshotId)).toBeUndefined();
    const accepted = acceptedWordPlanFromHistory(first.content)!;
    expect(accepted.plan.snapshot).toBe(snapshotId);
    expect(accepted.plan.sections?.length).toBeGreaterThan(0);
    expect(buildWordPlanReview(accepted.plan, snapshot).riskUnknown).toBe(
      false,
    );
  });

  it("follows a four-page read through its cursors and its table structure chunks", () => {
    const [user, assistant] = messagesOf(multiPage);
    const pages = toolUses(assistant);
    expect(pages).toHaveLength(4);
    const first = (
      pages[0].output as unknown as { result: Record<string, unknown> }
    ).result;
    expect(first.snapshot).not.toBe(
      (pages[0].input as unknown as { snapshot: string }).snapshot,
    );
    const snapshotId = first.snapshot as string;
    const snapshot = wordSnapshotFromHistory([user, assistant], snapshotId)!;
    expect(snapshot.read.size).toBe(54);
    expect(snapshot.blocks).toHaveLength(53);
    const table = snapshot.blocks.find((b) => b.ref === "b9")!;
    expect(table).toMatchObject({ type: "native", nativeKind: "table" });
    expect(table.content?.rows.length).toBeGreaterThan(1);
    expect(snapshot.blocks.find((b) => b.ref === "b62")?.content).toBeDefined();
    expect(snapshot.sections).toHaveLength(1);

    const missing = [
      user,
      { ...assistant, content: [pages[0], pages[1], pages[3]] },
    ];
    expect(wordSnapshotFromHistory(missing, snapshotId)).toBeUndefined();
    const restarted = [
      user,
      {
        ...assistant,
        content: [...pages, globalThis.structuredClone(pages[0])],
      },
    ];
    expect(wordSnapshotFromHistory(restarted, snapshotId)?.blocks).toHaveLength(
      53,
    );
  });

  it("follows read pages the model sent as replay records", () => {
    const [user, assistant] = messagesOf(multiPage);
    const pages = toolUses(assistant);
    const snapshotId = (
      pages[0].output as unknown as { result: { snapshot: string } }
    ).result.snapshot;
    const wrapped = pages.map(
      (page) =>
        ({
          ...page,
          input: { omitted_from_replay: "note", kept: page.input },
        }) as unknown as ContentPart,
    );
    const snapshot = wordSnapshotFromHistory(
      [user, { ...assistant, content: wrapped }],
      snapshotId,
    );
    expect(snapshot?.blocks).toHaveLength(53);
  });

  it("offers no plan when every attempt failed", () => {
    const [, assistant] = messagesOf(noAccepted);
    expect(
      toolUses(assistant).map(
        (p) =>
          (p.output as unknown as { submission: { status: string } }).submission
            .status,
      ),
    ).toEqual(["retry", "retry", "failed"]);
    expect(acceptedWordPlanFromHistory(assistant.content)).toBeUndefined();
  });

  it.each([
    { draft_id: "draft", revision: 1, patches: [] },
    {
      table_cell: {
        sourceRef: "b2",
        rowIndex: 0,
        cellIndex: 0,
        expectedText: "Old",
        text: "New",
      },
    },
  ])(
    "resolves a concise or repaired submission to the plan the host accepted",
    (submitted) => {
      const [, assistant] = messagesOf(retryAccepted);
      const accepted = toolUses(assistant)[2];
      const plan = accepted.input as unknown as {
        snapshot: string;
        readToken: string;
      };
      const output = accepted.output as unknown as {
        result: Record<string, unknown>;
      };
      const part = (result: Record<string, unknown>) =>
        ({
          ...accepted,
          input: {
            snapshot: plan.snapshot,
            readToken: plan.readToken,
            ...submitted,
          },
          output: { ...output, result },
        }) as unknown as ContentPart;
      expect(
        acceptedWordPlanFromHistory([part({ ...output.result, plan })])
          ?.content,
      ).toBe(JSON.stringify(plan));
      expect(
        acceptedWordPlanFromHistory([part(output.result)]),
      ).toBeUndefined();
      expect(
        acceptedWordPlanFromHistory([
          accepted,
          globalThis.structuredClone(accepted),
        ]),
      ).toBeUndefined();
    },
  );
});

describe("parts a smaller retry left out", () => {
  it("are read from the accepted call's receipt only", () => {
    const [, assistant] = messagesOf(retryAccepted);
    expect(wordPlanNotInProposal(assistant.content)).toEqual([]);
    const accepted = toolUses(assistant)[2];
    const output = accepted.output as unknown as {
      result: Record<string, unknown>;
    };
    output.result.notInProposal = ["§ 6 Lieferung", 7, " ", "§ 11 Kündigung"];
    expect(wordPlanNotInProposal(assistant.content)).toEqual([
      "§ 6 Lieferung",
      "§ 11 Kündigung",
    ]);
    expect(
      wordPlanNotInProposal(
        assistant.content.filter((part) => part !== accepted),
      ),
    ).toEqual([]);
  });
});

describe("Word read fragments", () => {
  const base = { ref: "b1", type: "paragraph", protected: false };

  it("rejoins text pieces, run slices cut at the boundary, and structure chunks", () => {
    const structure = JSON.stringify({ format: { alignment: "center" } });
    const snapshot = wordSnapshotFromHistory(
      [
        {
          content: [
            readPart(
              [
                {
                  ...base,
                  part: 1,
                  parts: 4,
                  text: "Bold start",
                  runs: [
                    { text: "Bold ", bold: true },
                    { text: "start", italic: true },
                  ],
                },
              ],
              { next: "c2" },
            ),
            readPart(
              [
                {
                  ...base,
                  part: 2,
                  parts: 4,
                  text: "ed here",
                  runs: [
                    { text: "ed", italic: true },
                    { text: " here", italic: true },
                  ],
                },
                {
                  ...base,
                  protected: false,
                  part: 3,
                  parts: 4,
                  text: "",
                  structureJson: structure.slice(0, 10),
                  structurePart: 1,
                  structureParts: 2,
                },
                {
                  ...base,
                  part: 4,
                  parts: 4,
                  text: "",
                  structureJson: structure.slice(10),
                  structurePart: 2,
                  structureParts: 2,
                },
              ],
              { cursor: "c2" },
            ),
          ],
        },
      ],
      "snap",
    )!;
    expect(snapshot.blocks).toEqual([
      {
        ...base,
        text: "Bold started here",
        runs: [
          { text: "Bold ", bold: true },
          { text: "started", italic: true },
          { text: " here", italic: true },
        ],
        format: { alignment: "center" },
        xml: "",
      },
    ]);
  });

  it("rejects a missing piece, unreadable structure or a short block count", () => {
    const one = (blocks: Record<string, unknown>[], total = 1) =>
      wordSnapshotFromHistory(
        [{ content: [readPart(blocks, { total })] }],
        "snap",
      );
    expect(one([{ ...base, part: 1, parts: 1, text: "x" }])).toBeDefined();
    expect(one([{ ...base, part: 1, parts: 2, text: "x" }])).toBeUndefined();
    expect(
      one([
        { ...base, part: 1, parts: 2, text: "x" },
        {
          ...base,
          part: 2,
          parts: 2,
          text: "",
          structureJson: "{broken",
          structurePart: 1,
          structureParts: 1,
        },
      ]),
    ).toBeUndefined();
    expect(one([{ ...base, part: 1, parts: 1, text: "x" }], 2)).toBeUndefined();
    expect(
      wordSnapshotFromHistory(
        [
          {
            content: [
              {
                ...(readPart([
                  { ...base, part: 1, parts: 1, text: "x" },
                ]) as object),
                input: {
                  snapshot: "snap",
                  table_cell: { sourceRef: "b1", rowIndex: 0, cellIndex: 0 },
                },
              } as unknown as ContentPart,
            ],
          },
        ],
        "snap",
      ),
    ).toBeUndefined();
  });

  it("follows only the requested branch", () => {
    const message = (id: string, previous?: string) =>
      ({
        id,
        previous_message_id: previous,
        content: [],
      }) as unknown as Message;
    const messages = {
      a: message("a"),
      b: message("b", "a"),
      c: message("c", "b"),
      sibling: message("sibling", "a"),
    };
    expect(wordMessageLineage(messages, "c").map((m) => m.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(wordMessageLineage(messages, "missing")).toEqual([]);
  });
});

const fenceEdits = (message: Message) => {
  const text = message.content
    .map((part) => (part.content_type === "text" ? part.text : ""))
    .join("");
  const body = /```erato-word-edits\n([\s\S]*?)\n```/u.exec(text)?.[1];
  return body === undefined ? null : parseWordEdits(body);
};

describe("Word paragraph edits restored from chat history", () => {
  it("pairs the edits with the numbered paragraphs the request sent", () => {
    const [user, assistant] = messagesOf(edits);
    const restored = fenceEdits(assistant)!;
    const source = wordEditSourceFromHistory(user);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ paragraph: 1, through: 9 });
    expect(source.paragraphs.size).toBe(9);
    expect(source.paragraphs.get(1)?.text).toBe(
      "To help, please tell me what you want to do:",
    );
    expect(source).toMatchObject({
      paragraphsSent: 10,
      paragraphsTotal: 10,
      partialOrdinal: null,
    });
    expect(source.documentName).toBeUndefined();
  });

  it("reads headings and a partly sent paragraph, and ignores prose mentions", () => {
    expect(
      wordParagraphsFromDocumentText("[1|H2] Scope\n[2] Body [x]\nnoise"),
    ).toEqual(
      new Map([
        [1, { text: "Scope", headingLevel: 2 }],
        [2, { text: "Body [x]" }],
      ]),
    );
    expect(
      wordEditSourceFromHistory({
        action_facet_args: {
          document_name: "Plan.docx",
          document_text: "[2] Old",
          truncation_note:
            "Paragraph 2 is included only in part, because it alone exceeds the send limit.",
        },
      }),
    ).toMatchObject({ partialOrdinal: 2, documentName: "Plan.docx" });
  });

  it("keeps blank paragraphs inside a span as blank lines", () => {
    const source = wordEditSourceFromHistory({
      action_facet_args: {
        document_text: "[1] Intro\n[3] Body\n[5] Close",
        paragraphs_sent: "6",
      },
    });
    expect(
      wordEditOriginal({ paragraph: 1, through: 5, text: "" }, source),
    ).toBe("Intro\n\nBody\n\nClose");
    expect(wordEditOriginal({ paragraph: 2, text: "" }, source)).toBeNull();
    expect(
      wordEditOriginal({ paragraph: 3, through: 7, text: "" }, source),
    ).toBeNull();
  });

  it("finds no original for a span over the partly sent paragraph", () => {
    const source = wordEditSourceFromHistory({
      action_facet_args: {
        document_text: "[1] Intro\n[2] Long",
        paragraphs_sent: "2",
        truncation_note:
          "Paragraph 2 is included only in part, because it alone exceeds the send limit.",
      },
    });
    expect(
      wordEditOriginal({ paragraph: 1, through: 2, text: "" }, source),
    ).toBeNull();
    expect(wordEditOriginal({ paragraph: 1, text: "" }, source)).toBe("Intro");
  });

  it("counts an absurd span without enumerating it, within the sent window", () => {
    const span = parseWordEdits(
      '{"edits":[{"paragraph":1,"through":4000000000,"text":"x"},{"paragraph":3,"through":8,"text":"y"}]}',
    )!;
    expect(editedParagraphCount(span)).toBe(4000000000);
    expect(editedParagraphCount(span, 10)).toBe(10);
    expect(
      editedParagraphCount([
        { paragraph: 2, through: 3, text: "" },
        { paragraph: 5, text: "" },
        { paragraph: 3, through: 4, text: "" },
      ]),
    ).toBe(4);
    expect(
      parseWordEdits('{"edits":[{"paragraph":1,"through":1e300,"text":"x"}]}'),
    ).toBeNull();
  });
});

describe("the Word history proposal", () => {
  it("normalises the accepted plan against the rebuilt snapshot", () => {
    const messages = messagesOf(retryAccepted);
    messages[0].action_facet_args = {
      ...messages[0].action_facet_args,
      document_name: "Quarterly.docx",
    };
    const assistant = messages[messages.length - 1];
    const submitted = toolUses(assistant).find(
      (part) =>
        (part.output as unknown as { submission?: { status?: string } })
          .submission?.status === "accepted",
    )!.input as unknown as WordDocumentPlan;
    const heading = (plan: WordDocumentPlan) =>
      plan.entries
        .flatMap((entry) => (entry.kind === "keep" ? [] : entry.blocks))
        .find((block) => block.id === "h-goal");
    heading(submitted)!.styleRef = "Heading1";
    const proposal = wordHistoryProposal(messages, assistant.content)!;
    const accepted = acceptedWordPlanFromHistory(assistant.content)!;
    expect(proposal.snapshot).toBeDefined();
    expect(heading(accepted.plan)?.styleRef).toBe("Heading1");
    expect(heading(proposal.plan)?.styleRef).toBeUndefined();
    expect(proposal.plan).toEqual(
      normalizeWordDocumentPlan(accepted.plan, proposal.snapshot),
    );
    expect(proposal.documentName).toBe("Quarterly.docx");
    expect(wordHistoryProposal(messages, accepted.content)).toEqual(proposal);
  });

  it("keys the proposal on its tool calls, not on streamed text", () => {
    const messages = messagesOf(retryAccepted);
    const assistant = messages[messages.length - 1];
    const key = wordHistoryProposalKey(messages, assistant.content);
    const streamed = [
      ...assistant.content,
      { content_type: "text", text: "More text" } as ContentPart,
    ];
    expect(wordHistoryProposalKey(messages, streamed)).toBe(key);
    const reads = messages.map((message) => ({
      ...message,
      content: message.content.filter(
        (part) =>
          part.content_type !== "tool_use" || part.tool_name !== WORD_READ_TOOL,
      ),
    }));
    expect(wordHistoryProposalKey(reads, assistant.content)).not.toBe(key);
  });
});

describe("Word plans restored from the parts a turn read", () => {
  const block = (ref: string, text: string, extra = {}) => ({
    ref,
    type: "paragraph",
    protected: false,
    text,
    ...extra,
  });
  const heading = (ref: string, text: string, level: number) =>
    block(ref, text, { type: "heading", level, styleRef: `Heading${level}` });
  const table = (ref: string, rows: string[][]) =>
    block(ref, rows.map((r) => r.join("\t")).join("\n"), {
      type: "native",
      nativeKind: "table",
      content: {
        columns: [2400, 2400],
        format: {},
        sourcePatchSupported: true,
        rows: rows.map((cells, sourceIndex) => ({
          sourceIndex,
          format: {},
          cells: cells.map((text, cellIndex) => ({
            sourceIndex: cellIndex,
            text,
          })),
        })),
      },
    });
  const document = [
    block("b1", "Master Services Agreement"),
    heading("b2", "1 Scope", 1),
    block("b3", "The Supplier provides the Services."),
    block("b4", "Changes need a Change Request."),
    heading("b5", "2 Fees", 1),
    heading("b6", "2.1 Rates", 2),
    block("b7", "Fees are invoiced monthly."),
    block("b8", "Invoices fall due after thirty days."),
    heading("b9", "3 Liability", 1),
    block("b10", "Neither Party is liable for indirect loss."),
    table("b11", [
      ["Service", "Level"],
      ["Hosting", "99.5 %"],
    ]),
    block("b12", "End."),
  ];
  const byRef = new Map(document.map((b) => [b.ref, b]));
  const outline = (lines: string[]) =>
    [WORD_OUTLINE_HEADER, ...lines].join("\n");
  const fullOutline = outline([
    "[b1|H1|0.1 KiB|1 ¶] (start of document)",
    "[b2|H1|0.2 KiB|3 ¶] 1 Scope",
    "[b5|H1|0.3 KiB|4 ¶] 2 Fees",
    "[b6|H2|0.2 KiB|3 ¶] 2.1 Rates",
    "[b9|H1|0.2 KiB|3 ¶] 3 Liability",
  ]);
  const tool = (
    name: string,
    input: Record<string, unknown>,
    output: Record<string, unknown>,
  ) =>
    ({
      content_type: "tool_use",
      tool_name: name,
      tool_call_id: `call-${JSON.stringify(input)}`,
      status: "success",
      input: { snapshot: "snap", ...input },
      output: { status: "success", ...output },
    }) as unknown as ContentPart;
  const read = (
    input: Record<string, unknown>,
    result: Record<string, unknown>,
  ) =>
    tool(
      WORD_READ_TOOL,
      { documentIdentity: "doc", ...input },
      { result: { snapshot: "snap", documentIdentity: "doc", ...result } },
    );
  const longText = byRef.get("b8")!.text.split(" ");
  const sectionRead = read(
    { section: { ref: "b5" } },
    {
      section: { ref: "b5", title: "2 Fees", level: 1, page: 1, pages: 1 },
      blocks: [
        byRef.get("b5"),
        byRef.get("b6"),
        byRef.get("b7"),
        {
          ...byRef.get("b8"),
          part: 1,
          parts: 2,
          text: `${longText.slice(0, 2).join(" ")} `,
        },
        {
          ...byRef.get("b8"),
          part: 2,
          parts: 2,
          text: longText.slice(2).join(" "),
        },
      ],
      nextCursor: null,
      complete: true,
      access: "read-only",
    },
  );
  const targetRead = read(
    { target: { refs: ["b3", "b10", "b10__field_1"] } },
    {
      scope: "objects",
      status: "ready",
      readToken: "scope-1",
      targets: [
        ...["b3", "b10"].map((ref) => ({
          ref,
          kind: "paragraph",
          text: byRef.get(ref)!.text,
          bodyRef: ref,
          content: byRef.get(ref),
        })),
        {
          ref: "b10__field_1",
          kind: "field",
          text: "PAGE",
          bodyRef: "b10",
          objectTarget: "field_1",
          content: { kind: "field", target: "field_1" },
        },
      ],
      styles: [{ id: "Normal", name: "Normal", type: "paragraph" }],
    },
  );
  const cellRead = read(
    {
      table_cell: { sourceRef: "b11", rowLabel: "Hosting", header: "Level" },
    },
    {
      scope: "table-cell",
      status: "ready",
      readToken: "cell-1",
      totalMatches: 1,
      candidates: [
        {
          sourceRef: "b11",
          rowIndex: 1,
          cellIndex: 1,
          text: { text: "99.5 %", truncated: false },
          header: { text: "Level", truncated: false },
          rowLabel: { text: "Hosting", truncated: false },
        },
      ],
      target: { sourceRef: "b11", rowIndex: 1, cellIndex: 1 },
    },
  );
  const replace = (ref: string, text: string) => ({
    kind: "replace" as const,
    source: [ref],
    blocks: [{ id: `new-${ref}`, type: "paragraph" as const, text }],
  });
  const plan: WordDocumentPlan = {
    version: 1,
    snapshot: "snap",
    readToken: "scope-1",
    scope: "body",
    entries: document.map((b) =>
      b.ref === "b3"
        ? replace("b3", "The Supplier provides the Services with care.")
        : b.ref === "b7"
          ? replace("b7", "Fees are invoiced quarterly.")
          : b.ref === "b10"
            ? replace("b10", "Neither Party is liable for any indirect loss.")
            : b.ref === "b11"
              ? {
                  kind: "replace" as const,
                  source: ["b11"],
                  blocks: [
                    {
                      id: "cell-edit-table",
                      type: "table" as const,
                      text: "",
                      sourceRef: "b11",
                      rows: [0, 1].map((sourceIndex) => ({
                        sourceIndex,
                        cells: [0, 1].map((cellIndex) => ({
                          sourceIndex: cellIndex,
                          ...(sourceIndex === 1 && cellIndex === 1
                            ? {
                                textEdit: {
                                  expectedText: "99.5 %",
                                  text: "99.9 %",
                                },
                              }
                            : {}),
                        })),
                      })),
                    },
                  ],
                }
              : { kind: "keep" as const, source: [b.ref] },
    ),
    deleted: [],
  };
  const submit = (submitted: WordDocumentPlan) =>
    tool(
      "submit_document_plan",
      {
        readToken: "scope-1",
        scoped_edit: { body: [] },
      },
      {
        submission: { status: "accepted", attempts_remaining: 2 },
        result: {
          draft_id: `call-${JSON.stringify({ readToken: "scope-1", scoped_edit: { body: [] } })}`,
          snapshot: "snap",
          action: "word.apply_document_plan",
          plan: submitted,
        },
      },
    );
  const targets = (
    refs: string[],
    content: (ref: string) => unknown = (ref) => byRef.get(ref),
  ) =>
    read(
      { target: { refs } },
      {
        scope: "objects",
        status: "ready",
        readToken: "scope-1",
        targets: refs.map((ref) => ({
          ref,
          kind: "paragraph",
          text: byRef.get(ref)!.text,
          bodyRef: ref,
          content: content(ref),
        })),
      },
    );
  const turn = (
    reads: ContentPart[],
    headingOutline = fullOutline,
    submitted = plan,
  ) => {
    const user = {
      id: "user-1",
      role: "user",
      content: [],
      action_facet_args: {
        document_snapshot: "snap",
        heading_outline: headingOutline,
      },
    } as unknown as Message;
    const answer = {
      id: "answer-1",
      role: "assistant",
      content: [...reads, submit(submitted)],
    } as unknown as Message;
    return wordHistoryProposal([user, answer], answer.content)!;
  };
  const changed = (proposal: ReturnType<typeof turn>) =>
    buildWordPlanReview(proposal.plan, proposal.snapshot)
      .groups.filter((g) => g.status !== "unchanged")
      .map((g) => ({
        heading: g.heading?.text,
        rows: g.rows.flatMap((r) =>
          r.family === "text"
            ? {
                before: r.before ?? null,
                after: r.after?.text,
                unread: !!r.unread,
              }
            : r.family === "table"
              ? {
                  cells: r.changedCells,
                  unread: !!r.unread,
                  sameShape: r.sameShape,
                }
              : [],
        ),
      }));

  it("rebuilds the blocks those reads returned, in document order", () => {
    const { snapshot } = turn([cellRead, targetRead, sectionRead]);

    expect(snapshot?.partial?.order).toEqual(document.map((b) => b.ref));
    expect(snapshot!.blocks.map((b) => b.ref)).toEqual([
      "b3",
      "b5",
      "b6",
      "b7",
      "b8",
      "b10",
    ]);
    expect(snapshot!.blocks.find((b) => b.ref === "b8")).toEqual({
      ...byRef.get("b8"),
      xml: "",
    });
    expect(snapshot!.styles.map((s) => s.id)).toEqual(["Normal"]);
    expect(wordSnapshotFromHistory([{ content: [sectionRead] }], "snap")).toBe(
      undefined,
    );
  });

  it("shows before and after per changed block under the headings the reads and the outline name", () => {
    const proposal = turn([sectionRead, targetRead, cellRead]);
    const review = buildWordPlanReview(proposal.plan, proposal.snapshot);

    expect(review.size).toBe("large");
    expect(review.riskUnknown).toBe(false);
    expect(review.output).toBeUndefined();
    expect(changed(proposal)).toEqual([
      {
        heading: "1 Scope",
        rows: [
          {
            before: "The Supplier provides the Services.",
            after: "The Supplier provides the Services with care.",
            unread: false,
          },
        ],
      },
      {
        heading: "2.1 Rates",
        rows: [
          {
            before: "Fees are invoiced monthly.",
            after: "Fees are invoiced quarterly.",
            unread: false,
          },
        ],
      },
      {
        heading: "3 Liability",
        rows: [
          {
            before: "Neither Party is liable for indirect loss.",
            after: "Neither Party is liable for any indirect loss.",
            unread: false,
          },
          {
            cells: [
              {
                row: 1,
                col: 1,
                before: "99.5 %",
                after: "99.9 %",
                label: "Hosting · Level",
              },
            ],
            unread: true,
            sameShape: true,
          },
        ],
      },
    ]);
    expect(wordPlanText(proposal.plan, proposal.snapshot)).not.toContain(
      "Master Services Agreement",
    );
  });

  it("says when a changed block was never read", () => {
    const proposal = turn([sectionRead]);

    expect(changed(proposal).map((g) => g.heading)).toEqual([
      "1 Scope",
      "2.1 Rates",
      "3 Liability",
    ]);
    expect(changed(proposal)[0].rows).toEqual([
      {
        before: null,
        after: "The Supplier provides the Services with care.",
        unread: true,
      },
    ]);
    expect(
      buildWordPlanReview(proposal.plan, proposal.snapshot).rows.find(
        (r) => r.key === "output:new-b3",
      )?.status,
    ).toBe("changed");
  });

  const shortened = outline([
    "[b2|H1|0.2 KiB|3 ¶] 1 Scope",
    "[b5|H1|0.3 KiB|4 ¶] 2 Fees",
    "[b9|H1|0.2 KiB|3 ¶] 3 Liability",
    wordOutlineOmission(1),
  ]);
  const headingsOf = (proposal: ReturnType<typeof turn>) =>
    changed(proposal).map((g) => g.heading);

  it("keeps a heading a section read returned below the levels a shortened outline kept", () => {
    expect(headingsOf(turn([sectionRead, targetRead], shortened))).toEqual([
      "1 Scope",
      "2.1 Rates",
      "3 Liability",
    ]);
  });

  it("puts a change under its chapter where a shortened outline left its section out and nobody read it", () => {
    expect(
      headingsOf(turn([targets(["b3", "b7", "b10"]), cellRead], shortened)),
    ).toEqual(["1 Scope", "2 Fees", "3 Liability"]);
  });

  it("goes back to the chapter after a section read ends", () => {
    const deeper = document.map((b) =>
      b.ref === "b8" ? heading("b8", "2.2 Terms", 2) : b,
    );
    const words = new Map(deeper.map((b) => [b.ref, b]));
    const proposal = turn(
      [
        read(
          { section: { ref: "b6" } },
          {
            blocks: ["b6", "b7"].map((ref) => words.get(ref)),
            nextCursor: null,
          },
        ),
        targets(["b3", "b10"]),
        cellRead,
      ],
      shortened,
      {
        ...plan,
        entries: plan.entries.map((entry) =>
          entry.kind === "replace" && ["b10", "b11"].includes(entry.source[0])
            ? { kind: "keep", source: entry.source }
            : entry,
        ),
        deleted: [],
      },
    );
    const review = buildWordPlanReview(proposal.plan, proposal.snapshot);

    expect(review.groups.map((g) => g.heading?.text)).toEqual([
      undefined,
      "1 Scope",
      "2 Fees",
      "2.1 Rates",
      "2 Fees",
      "3 Liability",
    ]);
    expect(headingsOf(proposal)).toEqual(["1 Scope", "2.1 Rates"]);
  });

  it("starts a section at a numbered heading the outline lists, read or not", () => {
    const numbered = (ref: string) =>
      ref === "b9"
        ? {
            ...byRef.get(ref),
            type: "list-item",
            level: 0,
            list: "existing-7",
            ordered: true,
          }
        : byRef.get(ref);
    const proposal = turn([
      targets(["b9", "b10"], numbered),
      targets(["b3", "b7"]),
      cellRead,
    ]);

    expect(headingsOf(proposal)).toEqual([
      "1 Scope",
      "2.1 Rates",
      "3 Liability",
    ]);
  });

  it("leaves a section title off only the changes the reads cannot place", () => {
    const cut = outline([
      "[b2|H1|0.2 KiB|3 ¶] 1 Scope",
      "[b5|H1|0.3 KiB|4 ¶] 2 Fees",
      wordOutlineOmission(2, "b9"),
    ]);
    const reads = [sectionRead, targets(["b3", "b10"]), cellRead];
    const titlesOf = (proposal: ReturnType<typeof turn>) =>
      buildWordPlanReview(proposal.plan, proposal.snapshot)
        .groups.filter((g) => g.status !== "unchanged")
        .map((g) => g.heading?.text ?? (g.sectionUnknown ? "unknown" : ""));

    expect(titlesOf(turn(reads, cut))).toEqual([
      "1 Scope",
      "2.1 Rates",
      "unknown",
    ]);
    for (const proposal of [
      turn(reads, ""),
      turn(reads, outline(["b2 H1 1 Scope"])),
    ])
      expect(titlesOf(proposal)).toEqual(["unknown", "2.1 Rates", "unknown"]);
    expect(
      headingsOf(
        turn([sectionRead, targets(["b3", "b9", "b10", "b12"]), cellRead], cut),
      ),
    ).toEqual(["1 Scope", "2.1 Rates", "3 Liability"]);
  });

  it("titles an unread section by its outline title and marks one the outline cut", () => {
    const long = "A".repeat(80);
    const proposal = turn(
      [targets(["b3", "b7", "b10"]), cellRead],
      outline([
        "[b2|H1|0.2 KiB|3 ¶] 1 Scope",
        wordOutlineLine({
          ref: "b5",
          level: 1,
          tag: "H",
          title: long,
          kib: 0.3,
          paragraphs: 4,
        }),
        "[b6|H2|0.2 KiB|3 ¶] 2.1 Rates",
        "[b9|H1|0.2 KiB|3 ¶] 3 Liability",
      ]),
    );

    expect(
      buildWordPlanReview(proposal.plan, proposal.snapshot).groups.find(
        (g) => g.heading?.level === 1 && g.heading.text.startsWith("A"),
      )?.heading?.text,
    ).toBe(`${long}…`);
  });

  it("marks a removed block nobody read, says the checks could not see it and counts unread kept blocks as blocks", () => {
    const proposal = turn([targets(["b3", "b7"])], fullOutline, {
      ...plan,
      entries: plan.entries.filter(
        (e) => e.kind === "insert" || !["b10", "b11"].includes(e.source[0]),
      ),
      deleted: [{ source: ["b10", "b11"], reason: "Moved to the annex." }],
    });
    const review = buildWordPlanReview(proposal.plan, proposal.snapshot);

    expect(review.riskUnknown).toBe(true);
    expect(
      review.rows.filter((r) => r.status === "removed").map((r) => r.unread),
    ).toEqual([true, true]);
    expect(
      review.rows.find((r) => r.family === "unchanged" && r.key === "keep:b1"),
    ).toMatchObject({ count: 1, paragraphs: 0, unreadBlocks: 1 });
    expect(
      buildWordPlanReview(
        plan,
        turn([sectionRead, targetRead, cellRead]).snapshot,
      ).riskUnknown,
    ).toBe(false);
  });

  it("says a stored plan that changes section breaks could not be checked", () => {
    const proposal = turn([sectionRead, targetRead, cellRead], fullOutline, {
      ...plan,
      scope: "document",
      sections: [{ id: "s1", source: "s1" }],
    });
    const review = buildWordPlanReview(proposal.plan, proposal.snapshot);

    expect(review.riskUnknown).toBe(true);
    expect(review.risks).toEqual([]);
    expect(review.partsRows).toHaveLength(1);
  });

  it("keeps the complete read when the turn also read a section", () => {
    const complete = readPart([{ ...byRef.get("b1"), part: 1, parts: 1 }]);
    const snapshot = wordSnapshotFromHistory(
      [{ content: [complete, sectionRead] }],
      "snap",
    );

    expect(snapshot?.partial).toBeUndefined();
    expect(snapshot?.blocks.map((b) => b.ref)).toEqual(["b1"]);
  });

  it("keeps the plan-only review when the turn read nothing", () => {
    expect(turn([]).snapshot).toBeUndefined();
  });
});
