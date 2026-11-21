import {
  buildWordPlanReview,
  normalizeWordDocumentPlan,
  parseWordOutline,
  wordHistoryProposal,
} from "@erato/frontend/word-review";
import { describe, expect, it } from "vitest";

import { largeDocumentTurn } from "../../../test/mocks/word/largeDocumentTurn";
import {
  body,
  chapter,
  clauseText,
  heading,
} from "../../../test/mocks/word/sectionFixtures";

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

describe("a stored plan on a document too large for a complete read", () => {
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
                snapshot.blocks.findIndex((b) => b.text === "6.1 Section 6.1") +
                  1
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

  it("lists changes without section titles past the end of a cut outline", async () => {
    const title = (k: number) =>
      `Clause ${k}: obligations of the parties under this agreement`;
    const blocks = Array.from({ length: 130 }, (_, k) => [
      heading(1, title(k + 1)),
      ...[0, 1, 2, 3].map((p) => body(clauseText(k * 4 + p, 400))),
    ]).flat();
    const { user, proposal, history, live, changed } = await storedAndLive({
      blocks,
      sections: [],
      replaced: [title(3), title(125)],
    });
    const outline = parseWordOutline(
      String(user.action_facet_args?.heading_outline),
    );
    expect(outline?.endsBefore).toBeDefined();
    expect(outline?.headings.size).toBeLessThan(125);

    expect(proposal.snapshot?.partial?.headings.size).toBe(0);
    expect(changedGroups(history)).toEqual([
      {
        heading: undefined,
        rows: changed.map((b, k) => ({
          status: "changed",
          before: b.text,
          after: `Revised ${k}.`,
          unread: false,
        })),
      },
    ]);
    expect(changedGroups(live).map((g) => g.heading)).toEqual([
      title(3),
      title(125),
    ]);
  });
});
