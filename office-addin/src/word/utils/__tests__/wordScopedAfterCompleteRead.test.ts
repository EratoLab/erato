import {
  canonicalWordPlan,
  normalizeWordDocumentPlan,
  parseWordDocumentPlan,
  validateWordDocumentPlan,
} from "@erato/frontend/word-review";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setWordWebImport } from "../../../test/mocks/word/applyPolicy";
import {
  packageXml,
  paragraph,
  readySnapshot,
} from "../../../test/mocks/word/authoringFixtures";
import { installWordOoxmlHost } from "../../../test/mocks/word/ooxmlHost";
import {
  captureRealisticSnapshot,
  realisticWordPackageXml,
} from "../../../test/mocks/word/realisticWordFixtures";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
} from "../wordDocumentXml";
import {
  ALL_WORD_IN_PLACE_CAPABILITIES,
  setWordInPlaceCapabilitiesForTests,
} from "../wordInPlaceCapabilities";
import { resetWordInPlaceLatchForTests } from "../wordInPlaceSwitch";
import { wordTargetInventory } from "../wordTargetRead";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanBlock,
} from "@erato/frontend/word-review";

const context = { chatId: "chat", messageId: "message", toolCallId: "read" };
const block = (id: string, text: string): WordPlanBlock => ({
  id,
  type: "paragraph",
  text,
});
const paragraphs = (count: number) =>
  readySnapshot(
    packageXml(
      Array.from({ length: count }, (_, i) =>
        paragraph(`Paragraph ${i + 1}`),
      ).join(""),
    ),
  );

function setup(snapshot: WordAuthoringSnapshot = paragraphs(40)) {
  const session = new WordDocumentReadSession();
  session.activate(snapshot, context);
  const execute = createWordDocumentSubmissionExecutor(session);
  let calls = 0;
  return {
    snapshot,
    session,
    async completeRead(): Promise<string> {
      let cursor: string | null = null;
      for (;;) {
        const result = await session.execute(
          { snapshot: snapshot.token, cursor },
          context,
        );
        if (!result.ok) throw Error(result.error);
        const page = result.result as {
          complete: boolean;
          nextCursor: string | null;
          readToken?: string;
        };
        if (page.complete) return page.readToken!;
        cursor = page.nextCursor;
      }
    },
    submit(args: Record<string, unknown>) {
      return execute(args, { ...context, toolCallId: `edit-${++calls}` });
    },
    sparse(readToken: string, scoped_edit: Record<string, unknown>) {
      return this.submit({ snapshot: snapshot.token, readToken, scoped_edit });
    },
  };
}

type Submission = Awaited<ReturnType<ReturnType<typeof setup>["submit"]>>;

function accepted(result: Submission, snapshot: WordAuthoringSnapshot) {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw Error(result.error);
  const plan = parseWordDocumentPlan(
    JSON.stringify((result.result as { plan: unknown }).plan),
  )!;
  expect(validateWordDocumentPlan(plan, snapshot)).toBeNull();
  const after = captureWordAuthoringSnapshot(
    compileWordDocumentPlan(plan, snapshot),
    snapshot.identity,
    "Off",
    snapshot.fullDocument,
  );
  expect(verifyWordPlanOutput(plan, snapshot, after)).toBe(true);
  return { plan, after };
}

/** The full plan the model had to write before: every untouched block kept by reference. */
function fullPlan(
  snapshot: WordAuthoringSnapshot,
  readToken: string,
  change: (ref: string) => WordDocumentPlan["entries"] | undefined,
): WordDocumentPlan {
  return {
    version: 1,
    snapshot: snapshot.token,
    readToken,
    scope: "body",
    entries: snapshot.blocks.flatMap(
      (b) => change(b.ref) ?? [{ kind: "keep" as const, source: [b.ref] }],
    ),
    deleted: [],
  };
}

const normalized = (plan: WordDocumentPlan, snapshot: WordAuthoringSnapshot) =>
  canonicalWordPlan(
    normalizeWordDocumentPlan(
      parseWordDocumentPlan(JSON.stringify(plan))!,
      snapshot,
    ),
  );

describe("sparse changes after a complete read", () => {
  it("inserts blocks in one sparse call and expands to the full plan the model no longer writes", async () => {
    const s = setup();
    const readToken = await s.completeRead();
    const inserted: WordPlanBlock[] = [
      block("n1", "New paragraph"),
      {
        id: "n2",
        type: "list-item",
        text: "New item",
        list: "new-list",
        level: 0,
        ordered: false,
      },
    ];
    const result = await s.sparse(readToken, {
      body: [{ operation: "insert-after", anchor: "b20", blocks: inserted }],
    });
    const { plan, after } = accepted(result, s.snapshot);
    expect(canonicalWordPlan(plan)).toBe(
      normalized(
        fullPlan(s.snapshot, readToken, (ref) =>
          ref === "b20"
            ? [
                { kind: "keep", source: ["b20"] },
                { kind: "insert", contextRefs: ["b20"], blocks: inserted },
              ]
            : undefined,
        ),
        s.snapshot,
      ),
    );
    expect(after.blocks.map((b) => b.text).slice(19, 23)).toEqual([
      "Paragraph 20",
      "New paragraph",
      "New item",
      "Paragraph 21",
    ]);
    expect(after.blocks).toHaveLength(42);
  });

  it("replaces, deletes and moves blocks in one sparse call", async () => {
    const s = setup();
    const readToken = await s.completeRead();
    const result = await s.sparse(readToken, {
      body: [
        {
          operation: "replace",
          source: ["b5", "b6"],
          blocks: [
            { id: "h", type: "heading", level: 1, text: "Merged heading" },
            block("p", "Merged text"),
          ],
        },
        { operation: "delete", source: ["b30"], reason: "Requested removal" },
        { operation: "move-after", source: ["b40"], anchor: "b1" },
      ],
    });
    const { after } = accepted(result, s.snapshot);
    const texts = after.blocks.map((b) => b.text);
    expect(texts.slice(0, 7)).toEqual([
      "Paragraph 1",
      "Paragraph 40",
      "Paragraph 2",
      "Paragraph 3",
      "Paragraph 4",
      "Merged heading",
      "Merged text",
    ]);
    expect(texts).not.toContain("Paragraph 30");
    expect(texts).toHaveLength(39);
    // Untouched blocks keep their exact source.
    expect(after.blocks[2].xml).toBe(s.snapshot.blocks[1].xml);
  });

  it("still accepts the equivalent full plan after a complete read", async () => {
    const s = setup();
    const readToken = await s.completeRead();
    const result = await s.submit({
      ...fullPlan(s.snapshot, readToken, (ref) =>
        ref === "b3"
          ? [{ kind: "replace", source: ["b3"], blocks: [block("r", "Full")] }]
          : undefined,
      ),
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("returns no draft handle for a rejected sparse change, and the corrected sparse change goes through", async () => {
    const s = setup();
    const readToken = await s.completeRead();
    const rejected = await s.sparse(readToken, {
      body: [
        {
          operation: "insert-after",
          anchor: "b2",
          blocks: [block("same", "One"), block("same", "Two")],
        },
      ],
    });
    if (rejected.ok) throw Error("The duplicate block IDs were accepted.");
    expect(rejected.validationErrors?.length).toBeGreaterThan(0);
    expect(rejected.submissionFeedback).toMatchObject({
      recovery: "repair_arguments",
      terminal: false,
    });
    expect(rejected.submissionFeedback?.draft).toBeUndefined();
    accepted(
      await s.sparse(readToken, {
        body: [
          {
            operation: "insert-after",
            anchor: "b2",
            blocks: [block("one", "One"), block("two", "Two")],
          },
        ],
      }),
      s.snapshot,
    );
  });

  it("keeps the snapshot, token, overlap and size checks", async () => {
    const insert = {
      operation: "insert-after",
      anchor: "b2",
      blocks: [block("n", "New")],
    };
    const cases: [
      string,
      (s: ReturnType<typeof setup>, token: string) => Promise<Submission>,
    ][] = [
      [
        "another snapshot",
        (s, token) =>
          s.submit({
            snapshot: "old",
            readToken: token,
            scoped_edit: { body: [insert] },
          }),
      ],
      ["an invented token", (s) => s.sparse("invented", { body: [insert] })],
      [
        "an anchor that is also replaced",
        (s, token) =>
          s.sparse(token, {
            body: [
              insert,
              {
                operation: "replace",
                source: ["b2"],
                blocks: [block("r", "R")],
              },
            ],
          }),
      ],
      [
        "a source changed twice",
        (s, token) =>
          s.sparse(token, {
            body: [
              { operation: "delete", source: ["b4"], reason: "Removal" },
              {
                operation: "replace",
                source: ["b4"],
                blocks: [block("r", "R")],
              },
            ],
          }),
      ],
      [
        "more than 24 KiB",
        (s, token) =>
          s.sparse(token, {
            body: [
              { ...insert, blocks: [block("big", "x".repeat(25 * 1024))] },
            ],
          }),
      ],
      [
        "a revoked capture",
        (s, token) => {
          s.snapshot.revoked = true;
          return s.sparse(token, { body: [insert] });
        },
      ],
    ];
    for (const [name, submit] of cases) {
      const s = setup();
      const token = await s.completeRead();
      expect((await submit(s, token)).ok, name).toBe(false);
    }
  });

  it("does not widen a target read's token after a complete read", async () => {
    const s = setup();
    await s.completeRead();
    const target = await s.session.execute(
      {
        snapshot: s.snapshot.token,
        documentIdentity: s.snapshot.identity,
        target: { ref: "b2" },
      },
      context,
    );
    if (!target.ok) throw Error(target.error);
    const scoped = (target.result as { readToken: string }).readToken;
    expect(
      (
        await s.sparse(scoped, {
          body: [{ operation: "delete", source: ["b1"], reason: "Outside" }],
        })
      ).ok,
    ).toBe(false);
  });

  it("is refused before the complete read has finished", async () => {
    const s = setup(paragraphs(3));
    s.snapshot.readToken = "early";
    expect(
      (
        await s.sparse("early", {
          body: [{ operation: "delete", source: ["b1"], reason: "Removal" }],
        })
      ).ok,
    ).toBe(false);
  });

  it("changes a native object by its block ref and target", async () => {
    const initial = captureWordAuthoringSnapshot(
      packageXml(["Before", "Target", "After"].map(paragraph).join("")),
      "doc-field",
      "Off",
      true,
    );
    initial.readToken = "fixture";
    const snapshot = captureWordAuthoringSnapshot(
      compileWordDocumentPlan(
        {
          version: 1,
          snapshot: initial.token,
          readToken: "fixture",
          scope: "body",
          entries: [
            { kind: "keep", source: ["b1"] },
            {
              kind: "replace",
              source: ["b2"],
              blocks: [
                {
                  id: "field",
                  type: "field",
                  text: "",
                  field: { instruction: "DATE", text: "Today" },
                },
              ],
            },
            { kind: "keep", source: ["b3"] },
          ],
          deleted: [],
        },
        initial,
      ),
      initial.identity,
      "Off",
      true,
    );
    const s = setup(snapshot);
    const readToken = await s.completeRead();
    const field = wordTargetInventory(snapshot).find(
      (t) => t.kind === "field" && t.objectTarget,
    )!;
    expect(field.ref).toBe(`${field.bodyRef}__${field.objectTarget}`);
    const { after } = accepted(
      await s.sparse(readToken, {
        objects: [
          { ref: field.ref, edit: { operation: "update", text: "Tomorrow" } },
        ],
      }),
      snapshot,
    );
    expect(after.blocks[0].xml).toBe(snapshot.blocks[0].xml);
    expect(after.blocks[2].xml).toBe(snapshot.blocks[2].xml);
  });
});

describe("sparse changes after a complete read on each host", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.WORD_IN_PLACE_APPLY = true;
  });

  async function realistic(profile?: "word-pc-16.0.20326") {
    installWordOoxmlHost(realisticWordPackageXml(), { profile });
    const s = setup(await captureRealisticSnapshot("message"));
    const readToken = await s.completeRead();
    const ref = (prefix: string) =>
      s.snapshot.blocks.find((b) => b.text.startsWith(prefix))!.ref;
    const header = s.snapshot.stories!.find((t) => t.type === "header")!;
    const section = s.snapshot.sections![0];
    return {
      insert: () =>
        s.sparse(readToken, {
          body: [
            {
              operation: "insert-after",
              anchor: ref("Status"),
              blocks: [block("n", "Inserted")],
            },
          ],
        }),
      reword: () =>
        s.sparse(readToken, {
          body: [
            {
              operation: "replace",
              source: [ref("Status")],
              blocks: [block("r", "Status: revised.")],
            },
          ],
        }),
      header: () =>
        s.sparse(readToken, {
          stories: [
            {
              kind: "upsert",
              type: "header",
              id: header.id,
              blocks: [block("h", "Revised header")],
            },
          ],
        }),
      sections: () =>
        s.sparse(readToken, {
          sections: [{ id: section.id, layout: { orientation: "landscape" } }],
        }),
    };
  }

  it("refuses on Word for the web, where nothing replaces the whole document, a sparse change that needs it", async () => {
    const edits = await realistic();
    expect(await edits.insert()).toMatchObject({
      ok: false,
      validationErrors: [
        {
          path: "",
          code: "web-needs-whole-document",
          message: expect.stringMatching(
            /^Word for the web writes edits only in place, and this edit needs a full-document rewrite because of: insert\b.*tell the user that this change needs Word for Windows or Mac\.$/,
          ),
        },
      ],
      submissionFeedback: { recovery: "repair_arguments", terminal: false },
    });
    expect((await edits.reword()).ok).toBe(true);
  });

  it("accepts on Word for the web, under confirm, what a full plan could do", async () => {
    const restore = setWordWebImport("confirm");
    try {
      expect((await (await realistic()).insert()).ok).toBe(true);
    } finally {
      restore();
    }
  });

  it("accepts body, header and section changes on Word PC", async () => {
    delete window.WORD_IN_PLACE_APPLY;
    for (const edit of ["insert", "reword", "header", "sections"] as const) {
      const result = await (await realistic("word-pc-16.0.20326"))[edit]();
      expect(result.ok, `${edit}: ${JSON.stringify(result)}`).toBe(true);
    }
  });
});

describe("sparse changes after a complete read under Track Changes", () => {
  beforeEach(() =>
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES),
  );
  afterEach(() => {
    resetWordInPlaceLatchForTests();
    setWordInPlaceCapabilitiesForTests(undefined);
    vi.unstubAllGlobals();
  });

  it("refuses a change that needs a full rewrite and accepts a reword", async () => {
    const host = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
      trackChanges: true,
    });
    host.setTrackingMode("TrackAll");
    const s = setup(await captureRealisticSnapshot("message", "TrackAll"));
    const readToken = await s.completeRead();
    expect(
      await s.sparse(readToken, {
        sections: [
          {
            id: s.snapshot.sections![0].id,
            layout: { orientation: "landscape" },
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      validationErrors: [
        expect.objectContaining({
          code: "tracking-needs-import",
          message: expect.stringContaining("because of: sections."),
        }),
      ],
    });
    const status = s.snapshot.blocks.find((b) => b.text.startsWith("Status"))!;
    expect(
      (
        await s.sparse(readToken, {
          body: [
            {
              operation: "replace",
              source: [status.ref],
              blocks: [block("r", "Status: revised.")],
            },
          ],
        })
      ).ok,
    ).toBe(true);
  });
});
