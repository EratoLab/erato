import {
  buildWordPlanReview,
  normalizeWordDocumentPlan,
  parseWordOutline,
  WORD_READ_TOOL,
  WORD_SUBMIT_PLAN_TOOL,
  wordHistoryProposal,
} from "@erato/frontend/word-review";
import { describe, expect, it } from "vitest";

import {
  packageXml,
  paragraph,
} from "../../../test/mocks/word/authoringFixtures";
import { storedWordToolPart as stored } from "../../../test/mocks/word/historyReads";
import { largeDocumentTurn } from "../../../test/mocks/word/largeDocumentTurn";
import {
  body,
  chapter,
  clauseText,
  heading,
  readContext,
} from "../../../test/mocks/word/sectionFixtures";
import { wordDocumentOutlineText } from "../wordDocumentOutline";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import { captureWordAuthoringSnapshot } from "../wordDocumentXml";

import type { LargeDocumentTurn } from "../../../test/mocks/word/largeDocumentTurn";
import type { ContentPart, Message } from "@erato/frontend/library";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanReview,
} from "@erato/frontend/word-review";

async function storedAndLive(turn: LargeDocumentTurn) {
  const { snapshot, reads, submission, user, plan, changed } =
    await largeDocumentTurn(turn);
  const answer = assistant([...reads, submission]);
  const proposal = wordHistoryProposal([user, answer], answer.content)!;
  return {
    snapshot,
    user,
    changed,
    proposal,
    history: buildWordPlanReview(proposal.plan, proposal.snapshot),
    live: liveReview(plan, snapshot),
  };
}

const assistant = (content: ContentPart[]) =>
  ({
    id: "assistant-1",
    role: "assistant",
    previous_message_id: "user-1",
    content,
  }) as unknown as Message;

const changedGroups = (review: WordPlanReview) =>
  review.groups
    .filter((g) => g.status !== "unchanged")
    .map((g) => ({
      heading: g.heading?.text,
      rows: g.rows
        .filter((r) => r.family === "text")
        .map((r) => ({
          status: r.status,
          before: r.before,
          after: r.after?.text,
          unread: !!r.unread,
        })),
    }));

const liveReview = (plan: WordDocumentPlan, snapshot: WordAuthoringSnapshot) =>
  buildWordPlanReview(normalizeWordDocumentPlan(plan, snapshot), snapshot);

describe(
  "a stored plan on a document too large for a complete read",
  {
    timeout: 30_000,
  },
  () => {
    it("shows before and after per changed block, grouped by heading, as the live card does", async () => {
      const { snapshot, reads, submission, user, changed, plan } =
        await largeDocumentTurn();
      const answer = assistant([...reads, submission]);

      const proposal = wordHistoryProposal([user, answer], answer.content)!;
      expect(proposal.snapshot?.partial).toBeDefined();
      expect(proposal.documentName).toBe("MSA.docx");
      const history = buildWordPlanReview(proposal.plan, proposal.snapshot);
      const live = liveReview(plan, snapshot);

      expect(history.size).toBe("large");
      expect(history.title).toEqual(live.title);
      expect(history.riskUnknown).toBe(false);
      expect(history.risks).toEqual(live.risks);
      expect(changedGroups(history)).toEqual(changedGroups(live));
      expect(changedGroups(history)).toEqual(
        ["2.1 Section 2.1", "4.2 Section 4.2", "6.3 Section 6.3"].map(
          (heading, k) => ({
            heading,
            rows: [
              {
                status: "changed",
                before: changed[k].text,
                after: `Revised ${k}.`,
                unread: false,
              },
            ],
          }),
        ),
      );
    });

    it("groups a change whose block was never read under the outline's heading and says the original is missing", async () => {
      const { reads, submission, user, changed } = await largeDocumentTurn();
      const sectionReads = reads.filter(
        (part) =>
          part.content_type === "tool_use" &&
          !!part.input &&
          "section" in (part.input as object),
      );
      const answer = assistant([...sectionReads, submission]);

      const { plan, snapshot } = wordHistoryProposal(
        [user, answer],
        answer.content,
      )!;
      const groups = changedGroups(buildWordPlanReview(plan, snapshot));

      expect(groups.map((g) => g.heading)).toEqual([
        "2.1 Section 2.1",
        "4.2 Section 4.2",
        "6.3 Section 6.3",
      ]);
      expect(groups.map((g) => g.rows[0])).toEqual([
        {
          status: "changed",
          before: changed[0].text,
          after: "Revised 0.",
          unread: false,
        },
        {
          status: "changed",
          before: undefined,
          after: "Revised 1.",
          unread: true,
        },
        {
          status: "changed",
          before: undefined,
          after: "Revised 2.",
          unread: true,
        },
      ]);
    });

    it("titles each change by its numbered heading, though Erato read those headings as list items", async () => {
      const { snapshot, history, live, changed } = await storedAndLive({
        numberedHeadings: true,
        sections: ["3. Chapter 3"],
        replaced: [
          "2.1 Section 2.1",
          "3.1 Section 3.1",
          "4.2 Section 4.2",
          "5.3 Section 5.3",
        ],
        deleted: ["6.1 Section 6.1"],
      });
      expect(
        snapshot.blocks.find((b) => b.text === "3. Chapter 3"),
      ).toMatchObject({ type: "list-item", outlineLevel: 1 });

      expect(changedGroups(history)).toEqual([
        ...[
          "2.1 Section 2.1",
          "3.1 Section 3.1",
          "4.2 Section 4.2",
          "5.3 Section 5.3",
        ].map((heading, k) => ({
          heading,
          rows: [
            {
              status: "changed",
              before: changed[k].text,
              after: `Revised ${k}.`,
              unread: false,
            },
          ],
        })),
        {
          heading: "6.1 Section 6.1",
          rows: [
            {
              status: "removed",
              before:
                snapshot.blocks[
                  snapshot.blocks.findIndex(
                    (b) => b.text === "6.1 Section 6.1",
                  ) + 1
                ].text,
              after: undefined,
              unread: false,
            },
          ],
        },
      ]);
      expect(history.riskUnknown).toBe(false);
      // The live card starts sections only at heading blocks, so it lists these flat.
      expect(live.groups.map((g) => g.heading)).toEqual([undefined]);
    });

    it("keeps the sections Erato read when the outline dropped their level, and the chapter elsewhere", async () => {
      const blocks = [
        body("Framework Agreement"),
        ...Array.from({ length: 50 }, (_, k) => chapter(k + 1, 5, 4)).flat(),
      ];
      const { user, history, live } = await storedAndLive({
        blocks,
        sections: ["7. Chapter 7"],
        replaced: ["7.1 Section 7.1", "7.2 Section 7.2", "9.2 Section 9.2"],
      });
      const outline = parseWordOutline(
        String(user.action_facet_args?.heading_outline),
      );
      expect(outline?.shortened).toBe(true);
      expect([...outline!.headings.values()].every((h) => h.level === 1)).toBe(
        true,
      );

      expect(changedGroups(history).map((g) => g.heading)).toEqual([
        "7.1 Section 7.1",
        "7.2 Section 7.2",
        "9. Chapter 9",
      ]);
      expect(changedGroups(live).map((g) => g.heading)).toEqual([
        "7.1 Section 7.1",
        "7.2 Section 7.2",
        "9.2 Section 9.2",
      ]);
    });

    it("leaves the section title off only the change past the end of a cut outline, also in an earlier release's outline", async () => {
      const title = (k: number) =>
        `Clause ${k}: obligations of the parties under this agreement`;
      const blocks = Array.from({ length: 130 }, (_, k) => [
        heading(1, title(k + 1)),
        ...[0, 1, 2, 3].map((p) => body(clauseText(k * 4 + p, 400))),
      ]).flat();
      const { snapshot, reads, submission, user, plan, changed } =
        await largeDocumentTurn({
          blocks,
          sections: [],
          replaced: [title(3), title(125)],
        });
      const outline = String(user.action_facet_args?.heading_outline);
      expect(parseWordOutline(outline)?.endsBefore).toBeDefined();
      expect(parseWordOutline(outline)?.headings.size).toBeLessThan(125);
      const earlier = outline.replace(
        / and the outline ends before b\d+;/u,
        ";",
      );
      expect(earlier).not.toBe(outline);
      const answer = assistant([...reads, submission]);

      for (const heading_outline of [outline, earlier]) {
        const request = {
          ...user,
          action_facet_args: { ...user.action_facet_args, heading_outline },
        } as Message;
        const proposal = wordHistoryProposal(
          [request, answer],
          answer.content,
        )!;
        const history = buildWordPlanReview(proposal.plan, proposal.snapshot);

        expect(changedGroups(history)).toEqual(
          [title(3), undefined].map((heading, k) => ({
            heading,
            rows: [
              {
                status: "changed",
                before: changed[k].text,
                after: `Revised ${k}.`,
                unread: false,
              },
            ],
          })),
        );
        expect(
          history.groups
            .filter((g) => g.status !== "unchanged")
            .map((g) => !!g.sectionUnknown),
        ).toEqual([false, true]);
      }
      expect(
        changedGroups(liveReview(plan, snapshot)).map((g) => g.heading),
      ).toEqual([title(3), title(125)]);
    });

    it("names a cell Erato read on its own by its row and column", async () => {
      const filler = (n: number) =>
        paragraph(
          `Background ${n}. ${"Archived notes and history. ".repeat(2000)}`,
        );
      const table =
        '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
        [
          ["Team", "Hours"],
          ["East", "18"],
          ["West", "21"],
        ]
          .map(
            (row) =>
              "<w:tr>" +
              row
                .map((cell) => `<w:tc><w:tcPr/>${paragraph(cell)}</w:tc>`)
                .join("") +
              "</w:tr>",
          )
          .join("") +
        "</w:tbl>";
      const snapshot = captureWordAuthoringSnapshot(
        packageXml(
          paragraph("Intro") + [1, 2, 3, 4].map(filler).join("") + table,
        ),
        "doc-A",
        "Off",
      );
      expect(snapshot.completeReadIssue).toBe("too-large");
      const session = new WordDocumentReadSession();
      session.activate(snapshot, readContext);
      const readInput = {
        snapshot: snapshot.token,
        documentIdentity: snapshot.identity,
        table_cell: { header: "Hours", rowLabel: "West" },
      };
      const read = await session.execute(readInput, {
        ...readContext,
        toolCallId: "read-1",
      });
      if (!read.ok) throw new Error(read.error);
      const { readToken, target } = read.result as {
        readToken: string;
        target: Record<string, unknown>;
      };
      const submitInput = {
        snapshot: snapshot.token,
        readToken,
        table_cell: { ...target, text: "22" },
      };
      const submitted = await createWordDocumentSubmissionExecutor(session)(
        submitInput,
        { ...readContext, toolCallId: "submit-1" },
      );
      if (!submitted.ok) throw new Error(submitted.error);
      const answer = assistant([
        stored(WORD_READ_TOOL, "read-1", readInput, {
          status: "success",
          result: read.result,
        }),
        stored(WORD_SUBMIT_PLAN_TOOL, "submit-1", submitInput, {
          status: "success",
          submission: { status: "accepted", attempts_remaining: 2 },
          result: submitted.result,
        }),
      ]);
      const user = {
        id: "user-1",
        role: "user",
        content: [],
        action_facet_args: {
          document_snapshot: snapshot.token,
          heading_outline: wordDocumentOutlineText(snapshot),
        },
      } as unknown as Message;

      const proposal = wordHistoryProposal([user, answer], answer.content)!;
      expect(proposal.snapshot?.partial).toBeDefined();
      expect(
        buildWordPlanReview(proposal.plan, proposal.snapshot).rows.find(
          (r) => r.family === "table",
        ),
      ).toMatchObject({
        unread: true,
        changedCells: [{ before: "21", after: "22", label: "West · Hours" }],
      });
    });
  },
);
