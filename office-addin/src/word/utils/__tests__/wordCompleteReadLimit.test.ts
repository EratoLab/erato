import {
  MAX_SOURCE_BYTES,
  parseWordDocumentPlan,
  validateWordDocumentPlan,
  wordSourceReadRefs,
} from "@erato/frontend/word-review";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  packageXml,
  paragraph,
} from "../../../test/mocks/word/authoringFixtures";
import { installWordOoxmlHost } from "../../../test/mocks/word/ooxmlHost";
import { realisticWordPackageXml } from "../../../test/mocks/word/realisticWordFixtures";
import { applyWordDocumentPlan } from "../wordApplyDocumentPlan";
import { captureWordDocumentPackage } from "../wordDocumentPackage";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
} from "../wordDocumentXml";
import { resetWordInPlaceLatchForTests } from "../wordInPlaceSwitch";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "@erato/frontend/word-review";

const context = {
  chatId: "chat-A",
  messageId: "message-A",
  toolCallId: "call-A",
};
const filler = (n: number) =>
  paragraph(`Background ${n}. ${"Archived notes and history. ".repeat(2000)}`);
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
        row.map((cell) => `<w:tc><w:tcPr/>${paragraph(cell)}</w:tc>`).join("") +
        "</w:tr>",
    )
    .join("") +
  "</w:tbl>";
const largeBody = (prefix = "") =>
  prefix +
  paragraph("Intro") +
  [1, 2, 3, 4].map(filler).join("") +
  table +
  paragraph("Target paragraph.") +
  paragraph("Closing line.");

function setup(body = largeBody()) {
  const snapshot = captureWordAuthoringSnapshot(
    packageXml(body),
    "doc-A",
    "Off",
  );
  const session = new WordDocumentReadSession();
  session.activate(snapshot, context);
  const read = (args: Record<string, unknown>) =>
    session.execute(
      {
        snapshot: snapshot.token,
        documentIdentity: snapshot.identity,
        ...args,
      },
      context,
    );
  const submit = createWordDocumentSubmissionExecutor(session);
  const readToken = async (args: Record<string, unknown>) => {
    const response = await read(args);
    expect(response).toMatchObject({ ok: true, result: { status: "ready" } });
    if (!response.ok) throw new Error(response.error);
    return response.result as {
      readToken: string;
      target?: Record<string, unknown>;
    };
  };
  return { snapshot, session, read, submit, readToken };
}
const ref = (snapshot: WordAuthoringSnapshot, text: string) =>
  snapshot.blocks.find((b) => b.text === text)!.ref;
const acceptedPlan = (
  result: Awaited<ReturnType<ReturnType<typeof setup>["submit"]>>,
) => {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return parseWordDocumentPlan(
    JSON.stringify((result.result as { plan: unknown }).plan),
  )!;
};
const wholeDocumentPlan = (
  snapshot: WordAuthoringSnapshot,
  readToken: string,
): WordDocumentPlan => ({
  version: 1,
  snapshot: snapshot.token,
  readToken,
  scope: "body",
  entries: snapshot.blocks.map((b) =>
    b.text === "Target paragraph."
      ? {
          kind: "replace",
          source: [b.ref],
          blocks: [{ id: "n1", type: "paragraph", text: "Rewritten." }],
        }
      : { kind: "keep", source: [b.ref] },
  ),
  deleted: [],
});

describe("a document too large for a complete read", () => {
  it("is captured with a complete-read limit, not a blocking issue", () => {
    const { snapshot } = setup();
    expect(
      new TextEncoder().encode(snapshot.blocks.map((b) => b.text).join(""))
        .length,
    ).toBeGreaterThan(MAX_SOURCE_BYTES);
    expect(snapshot.issue).toBeUndefined();
    expect(snapshot.completeReadIssue).toBe("too-large");
  });

  it("refuses the complete read and points to scoped reads", async () => {
    const { snapshot, session } = setup();
    const response = await session.execute(
      { snapshot: snapshot.token },
      context,
    );
    expect(response).toMatchObject({
      ok: false,
      validationErrors: [{ code: "too-large" }],
    });
    expect(!response.ok && response.error).toContain("target");
    expect(snapshot.readToken).toBeUndefined();
  });

  it("reads one target and accepts its scoped edit as a valid plan", async () => {
    const { snapshot, submit, readToken } = setup();
    const target = ref(snapshot, "Target paragraph.");
    const scope = await readToken({ target: { text: "Target paragraph" } });

    const plan = acceptedPlan(
      await submit(
        {
          snapshot: snapshot.token,
          readToken: scope.readToken,
          scoped_edit: {
            body: [
              {
                operation: "replace",
                source: [target],
                blocks: [{ id: "n1", type: "paragraph", text: "Rewritten." }],
              },
            ],
          },
        },
        context,
      ),
    );

    expect(validateWordDocumentPlan(plan, snapshot)).toBeNull();
    const after = captureWordAuthoringSnapshot(
      compileWordDocumentPlan(plan, snapshot),
      snapshot.identity,
      "Off",
      false,
      "verify",
    );
    expect(verifyWordPlanOutput(plan, snapshot, after)).toBe(true);
    expect(after.blocks.map((b) => b.text)).toContain("Rewritten.");
    expect(after.blocks.map((b) => b.text)).not.toContain("Target paragraph.");
    expect(snapshot.readToken).toBeUndefined();
  });

  it("reads several targets together in one batch", async () => {
    const { readToken } = setup();
    const scope = await readToken({
      target: {
        queries: [{ text: "Target paragraph" }, { text: "Closing line" }],
      },
    });
    expect(scope.readToken).toEqual(expect.any(String));
  });

  it("reads one table cell and accepts its edit", async () => {
    const { snapshot, submit, readToken } = setup();
    const scope = await readToken({
      table_cell: { header: "Hours", rowLabel: "West" },
    });

    const plan = acceptedPlan(
      await submit(
        {
          snapshot: snapshot.token,
          readToken: scope.readToken,
          table_cell: { ...scope.target, text: "22" },
        },
        context,
      ),
    );

    expect(validateWordDocumentPlan(plan, snapshot)).toBeNull();
  });

  it("still refuses a whole-document plan", async () => {
    const { snapshot, submit, readToken } = setup();
    const scope = await readToken({ target: { text: "Target paragraph" } });

    expect(
      await submit(wholeDocumentPlan(snapshot, "read-proof"), context),
    ).toMatchObject({ ok: false, validationErrors: [{ code: "too-large" }] });
    expect(
      await submit(wholeDocumentPlan(snapshot, scope.readToken), {
        ...context,
        toolCallId: "call-B",
      }),
    ).toMatchObject({
      ok: false,
      validationErrors: [{ code: "outside-read-scope" }],
    });
  });

  it("refuses a whole-document plan at validation even with a complete read recorded", () => {
    const { snapshot } = setup();
    snapshot.read = new Set(wordSourceReadRefs(snapshot));
    snapshot.readToken = "read-proof";
    expect(
      validateWordDocumentPlan(
        wholeDocumentPlan(snapshot, "read-proof"),
        snapshot,
      ),
    ).toBe("too-large");
  });

  it.each(["unsupported", "tracking", "unavailable", "model-budget"] as const)(
    "is fully blocked once it also has the %s issue",
    async (issue) => {
      const { snapshot, session, read, submit, readToken } = setup();
      const scope = await readToken({ target: { text: "Target paragraph" } });
      snapshot.issue = issue;

      expect(
        await read({ target: { text: "Target paragraph" } }),
      ).toMatchObject({ ok: false });
      expect(
        await read({ table_cell: { header: "Hours", rowLabel: "West" } }),
      ).toMatchObject({ ok: false });
      expect(
        await session.execute({ snapshot: snapshot.token }, context),
      ).toMatchObject({ ok: false, validationErrors: [{ code: issue }] });
      expect(
        await submit(
          {
            snapshot: snapshot.token,
            readToken: scope.readToken,
            scoped_edit: {
              body: [
                {
                  operation: "replace",
                  source: [ref(snapshot, "Target paragraph.")],
                  blocks: [{ id: "n1", type: "paragraph", text: "Changed." }],
                },
              ],
            },
          },
          context,
        ),
      ).toMatchObject({ ok: false });
    },
  );

  it("is fully blocked once the request's capture is revoked", async () => {
    const { snapshot, session, read } = setup();
    session.clear();
    expect(snapshot.revoked).toBe(true);
    expect(await read({ target: { text: "Target paragraph" } })).toMatchObject({
      ok: false,
    });
  });

  it("keeps a structural issue when the capture is also too large", () => {
    const { snapshot } = setup(
      largeBody('<w:p><w:bookmarkStart w:id="1"/></w:p>'),
    );
    expect(snapshot.issue).toBe("unsupported");
    expect(snapshot.completeReadIssue).toBe("too-large");
  });
});

describe("a scoped edit of a document too large for a complete read", () => {
  afterEach(() => {
    resetWordInPlaceLatchForTests();
    vi.unstubAllGlobals();
  });

  it("is applied to the document in Word", { timeout: 30_000 }, async () => {
    const closing =
      '<w:p><w:r><w:t xml:space="preserve">Closing paragraph.</w:t></w:r></w:p>';
    const host = installWordOoxmlHost(
      realisticWordPackageXml().replace(
        closing,
        [1, 2, 3, 4].map(filler).join("") + closing,
      ),
      { profile: "word-pc-16.0.20326" },
    );
    const file = await captureWordDocumentPackage();
    const snapshot = captureWordAuthoringSnapshot(
      file.ooxml,
      "doc-A",
      "Off",
      true,
    );
    expect(snapshot.completeReadIssue).toBe("too-large");
    const session = new WordDocumentReadSession();
    session.activate(snapshot, context);
    const read = await session.execute(
      {
        snapshot: snapshot.token,
        documentIdentity: snapshot.identity,
        target: { text: "the pilot is on track" },
      },
      context,
    );
    expect(read).toMatchObject({ ok: true, result: { status: "ready" } });
    if (!read.ok) throw new Error(read.error);
    const status = snapshot.blocks.find((b) =>
      b.text.includes("the pilot is on track"),
    )!.ref;

    const plan = acceptedPlan(
      await createWordDocumentSubmissionExecutor(session)(
        {
          snapshot: snapshot.token,
          readToken: (read.result as { readToken: string }).readToken,
          scoped_edit: {
            body: [
              {
                operation: "replace",
                source: [status],
                blocks: [
                  { id: "n1", type: "paragraph", text: "Status: rewritten." },
                ],
              },
            ],
          },
        },
        context,
      ),
    );
    const applied = await applyWordDocumentPlan(
      JSON.stringify(plan),
      snapshot,
      context.messageId,
    );

    expect(applied.status, JSON.stringify(applied.diagnostic)).toBe("applied");
    const after = captureWordAuthoringSnapshot(
      host.ooxml(),
      "doc-A",
      "Off",
      true,
      "verify",
    ).blocks.map((b) => b.text);
    expect(after).toContain("Status: rewritten.");
    expect(after.filter((t) => t.startsWith("Background"))).toHaveLength(4);
  });
});
