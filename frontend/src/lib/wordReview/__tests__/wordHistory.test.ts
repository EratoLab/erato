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
  wordSnapshotFromHistory,
  WORD_READ_TOOL,
} from "../wordHistory";
import { buildWordPlanReview } from "../wordPlanReview";
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
