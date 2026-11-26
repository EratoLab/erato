import {
  spokenApprovalFor,
  spokenApprovalPieces,
  voiceApprovalOffered,
} from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import { beforeEach, describe, expect, it } from "vitest";

import {
  examplePlan,
  readySnapshot,
} from "../../../test/mocks/word/authoringFixtures";
import { wordCommentApprovalPreview } from "../wordApprovalPreview";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";

import type { WordApprovalPreview } from "../wordApprovalPreview";
import type { WordCommentDraft } from "../wordCommentChanges";

const NOW = new Date("2026-11-24T09:00:00Z");
const context = {
  toolCallId: "submit-A",
  messageId: "message-A",
  chatId: "chat-A",
};

/** The labels the package gives the apply tools (erato-action-facets.toml). */
const LABELS = {
  apply_document_plan: { action: "update", object_kind: "document" },
  apply_comment_changes: { action: "comment", object_kind: "comment" },
} as const;

/** The decision-place item the server makes from the pane's receipt (chained_apply.rs). */
const spokenChange = (
  tool: keyof typeof LABELS,
  preview: WordApprovalPreview,
) =>
  spokenApprovalFor("client_tool", {
    tool_name: tool,
    input: { proposal_call_id: "submit-A", draft_id: "submit-A" },
    display: {
      title: preview.title,
      description: preview.summary,
      label: { ...LABELS[tool], source: "own_mapping" } as never,
    },
    follows: { decide_on_screen: preview.decide_on_screen },
  });

const said = (
  preview: WordApprovalPreview,
  tool: keyof typeof LABELS = "apply_document_plan",
) =>
  spokenApprovalPieces(spokenChange(tool, preview), {
    language: "en",
    now: NOW,
  }).map((piece) => [piece.role, piece.text]);

async function planPreview(): Promise<WordApprovalPreview> {
  const session = new WordDocumentReadSession();
  const snapshot = readySnapshot();
  session.activate(snapshot, context, undefined, { request: "Shorten it" });
  await session.execute(
    { snapshot: snapshot.token },
    { ...context, toolCallId: "read-A" },
  );
  const plan = examplePlan(snapshot.token);
  plan.readToken = snapshot.readToken!;
  const receipt = await createWordDocumentSubmissionExecutor(session)(
    plan,
    context,
  );
  if (!receipt.ok) throw new Error(receipt.error);
  return (receipt.result as { approval_preview: WordApprovalPreview })
    .approval_preview;
}

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});

describe("a Word change waiting in the decision place, by voice", () => {
  it("is said from the pane's title and summary, and can be approved by voice", async () => {
    const preview = await planPreview();
    expect(preview.title).not.toBe("");
    expect(preview.summary).not.toBe("");
    const pieces = said(preview);
    expect(pieces.map(([role]) => role)).toEqual(["what", "detail", "request"]);
    expect(pieces[0][1]).toBe(`${preview.title}.`);
    expect(pieces[1][1]).toBe(`${preview.summary}.`);
    expect(
      voiceApprovalOffered(spokenChange("apply_document_plan", preview)),
    ).toBe(true);
  });

  it("is said but never approved by voice when a tick is needed on screen", async () => {
    const preview = {
      ...(await planPreview()),
      decide_on_screen: true,
    };
    expect(said(preview).map(([role]) => role)).toEqual([
      "what",
      "detail",
      "request",
    ]);
    expect(
      voiceApprovalOffered(spokenChange("apply_document_plan", preview)),
    ).toBe(false);
  });

  it("names comment changes, and keeps rows the card must show on screen", () => {
    const draft = {
      draftId: "submit-A",
      action: "word.add_comments",
      identity: "doc-A",
      host: "PC",
      label: "Erato",
      authorMode: "assistant",
      rows: [{ i: 0, op: "add" }],
    } as unknown as WordCommentDraft;
    const clean = wordCommentApprovalPreview(draft, false);
    expect(said(clean, "apply_comment_changes")[1]).toEqual([
      "detail",
      `${clean.summary}.`,
    ]);
    expect(
      voiceApprovalOffered(spokenChange("apply_comment_changes", clean)),
    ).toBe(true);
    // Text by someone other than the user went into the request: the rows wait on screen.
    const tainted = wordCommentApprovalPreview(draft, true);
    expect(tainted.decide_on_screen).toBe(true);
    expect(
      voiceApprovalOffered(spokenChange("apply_comment_changes", tainted)),
    ).toBe(false);
  });
});
