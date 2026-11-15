import { describe, expect, it } from "vitest";

import {
  packageXml,
  paragraph,
  readySnapshot,
} from "../../../test/mocks/word/authoringFixtures";
import {
  WORD_NO_REQUEST_SESSION_MESSAGE,
  WordDocumentReadSession,
} from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
} from "../wordDocumentXml";
import {
  expandWordScopedSubmission,
  wordScopedIssues,
} from "../wordScopedSubmission";
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
const cell = (id: string) => ({ blocks: [block(id, id)] });
const texts = (count: number) =>
  packageXml(
    Array.from({ length: count }, (_, i) =>
      paragraph(`Paragraph ${i + 1}`),
    ).join(""),
  );

function setup(snapshot: WordAuthoringSnapshot = readySnapshot(texts(40))) {
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
    sparse(readToken: string, scoped_edit: Record<string, unknown>) {
      return execute(
        { snapshot: snapshot.token, readToken, scoped_edit },
        { ...context, toolCallId: `edit-${++calls}` },
      );
    },
  };
}

/** Four paragraphs in two sections; b2 ends the first. */
function twoSections(fullDocument = true): WordAuthoringSnapshot {
  const initial = captureWordAuthoringSnapshot(texts(4), "doc", "Off", true);
  initial.readToken = "fixture";
  const split: WordDocumentPlan = {
    version: 1,
    snapshot: initial.token,
    readToken: "fixture",
    scope: "document",
    entries: initial.blocks.map((b) => ({ kind: "keep", source: [b.ref] })),
    deleted: [],
    sections: [
      { id: "first", after: "b2" },
      { id: "second", source: initial.sections![0].id },
    ],
  };
  return captureWordAuthoringSnapshot(
    compileWordDocumentPlan(split, initial),
    initial.identity,
    "Off",
    fullDocument,
  );
}

const insert = (anchor: string, blocks: unknown[]) => ({
  operation: "insert-after",
  anchor,
  blocks,
});

describe("a rejected sparse change points at the change the model sent", () => {
  it.each<[string, Record<string, unknown>, string, string]>([
    [
      "two inserts reuse an id",
      {
        body: [
          insert("b3", [block("x", "1")]),
          insert("b9", [block("x", "2")]),
        ],
      },
      "duplicate-id",
      "/scoped_edit/body/1/blocks/0/id",
    ],
    [
      "an inserted table's cell reuses an id",
      {
        body: [
          insert("b1", [block("lead", "Lead")]),
          insert("b2", [
            block("dup", "Intro"),
            {
              id: "t",
              type: "table",
              rows: [
                { cells: [cell("c0")] },
                { cells: [cell("c1")] },
                { cells: [cell("dup")] },
              ],
            },
          ]),
        ],
      },
      "duplicate-id",
      "/scoped_edit/body/1/blocks/1/rows/2/cells/0/blocks/0/id",
    ],
    [
      "a new block takes an existing ref as its id",
      { body: [insert("b5", [block("b7", "New")])] },
      "duplicate-id",
      "/scoped_edit/body/0/blocks/0/id",
    ],
    [
      "a table has ragged rows",
      {
        body: [
          insert("b7", [
            {
              id: "t",
              type: "table",
              rows: [{ cells: [cell("a"), cell("b")] }, { cells: [cell("c")] }],
            },
          ]),
        ],
      },
      "table-grid",
      "/scoped_edit/body/0/blocks/0/rows",
    ],
    [
      "a table has no rows",
      { body: [insert("b7", [{ id: "t", type: "table", rows: [] }])] },
      "table-rows",
      "/scoped_edit/body/0/blocks/0/rows",
    ],
    [
      "a heading has level 42",
      {
        body: [
          insert("b1", [{ id: "h", type: "heading", text: "H", level: 42 }]),
        ],
      },
      "heading-level",
      "/scoped_edit/body/0/blocks/0/level",
    ],
    [
      "a list item has an invalid list name",
      {
        body: [
          insert("b1", [
            {
              id: "l",
              type: "list-item",
              text: "Item",
              list: "not a name",
              ordered: false,
              level: 0,
            },
          ]),
        ],
      },
      "list-id",
      "/scoped_edit/body/0/blocks/0/list",
    ],
    [
      "a list item has level 9",
      {
        body: [
          insert("b1", [
            {
              id: "l",
              type: "list-item",
              text: "Item",
              list: "new-list",
              ordered: false,
              level: 9,
            },
          ]),
        ],
      },
      "list-level",
      "/scoped_edit/body/0/blocks/0/level",
    ],
    [
      "an anchor is unknown",
      {
        body: [
          insert("b1", [block("a", "A")]),
          insert("b99", [block("b", "B")]),
        ],
      },
      "outside-read-scope",
      "/scoped_edit/body/1/anchor",
    ],
    [
      "one ref is replaced and deleted",
      {
        body: [
          { operation: "replace", source: ["b4"], blocks: [block("r", "R")] },
          { operation: "delete", source: ["b4"], reason: "Removal" },
        ],
      },
      "scoped-shape",
      "/scoped_edit/body/1/source",
    ],
    [
      "an anchor is also replaced",
      {
        body: [
          insert("b2", [block("n", "New")]),
          { operation: "replace", source: ["b2"], blocks: [block("r", "R")] },
        ],
      },
      "scoped-shape",
      "/scoped_edit/body/0/anchor",
    ],
    [
      "a block is moved after itself",
      {
        body: [{ operation: "move-after", source: ["b6"], anchor: "b6" }],
      },
      "scoped-shape",
      "/scoped_edit/body/0/anchor",
    ],
    [
      "a section change reaches a body-only capture",
      { sections: [{ id: "new", after: "b2" }] },
      "scoped-shape",
      "/scoped_edit/sections",
    ],
  ])("when %s", async (_, change, code, path) => {
    const s = setup();
    const result = await s.sparse(await s.completeRead(), change);
    expect(result).toMatchObject({
      ok: false,
      validationErrors: [{ code, path }],
    });
    expect(JSON.stringify(result)).not.toMatch(/\/entries\/\d/);
  });

  it("names the section change whose boundary is unknown", async () => {
    const s = setup(captureWordAuthoringSnapshot(texts(4), "doc", "Off", true));
    expect(
      await s.sparse(await s.completeRead(), {
        sections: [{ id: "new", after: "b99" }],
      }),
    ).toMatchObject({
      ok: false,
      validationErrors: [
        { code: "outside-read-scope", path: "/scoped_edit/sections/0/after" },
      ],
    });
  });

  it("points a change that drops a section break at that change", async () => {
    const s = setup(twoSections());
    const [first, second] = s.snapshot.sections!;
    const readToken = await s.completeRead();
    const hint = `Block b2 ends section ${first.id}; leave it out of this change, or add a sections change for ${first.id} (after: a read block you keep, or delete: true).`;
    expect(
      await s.sparse(readToken, {
        body: [
          insert("b1", [block("n", "New")]),
          { operation: "replace", source: ["b2"], blocks: [block("r", "R")] },
        ],
      }),
    ).toMatchObject({
      ok: false,
      validationErrors: [
        {
          code: "scoped-shape",
          path: "/scoped_edit/body/1/source/0",
          message: hint,
        },
      ],
    });
    expect(
      await s.sparse(readToken, {
        body: [{ operation: "delete", source: ["b2"], reason: "Removal" }],
        sections: [{ id: second.id, layout: { orientation: "landscape" } }],
      }),
    ).toMatchObject({
      ok: false,
      validationErrors: [
        {
          code: "scoped-shape",
          path: "/scoped_edit/body/0/source/0",
          message: hint,
        },
      ],
    });
  });

  it("offers no sections change on a body-only capture", async () => {
    const s = setup(twoSections(false));
    expect(
      await s.sparse(await s.completeRead(), {
        body: [
          { operation: "replace", source: ["b2"], blocks: [block("r", "R")] },
        ],
      }),
    ).toMatchObject({
      ok: false,
      validationErrors: [
        {
          path: "/scoped_edit/body/0/source/0",
          message: expect.stringMatching(
            /^Block b2 ends (a section|section \S+); leave it out of this change\.$/,
          ),
        },
      ],
    });
  });

  it("accepts the change when it also moves that section's end", async () => {
    const s = setup(twoSections());
    const [first] = s.snapshot.sections!;
    const result = await s.sparse(await s.completeRead(), {
      body: [
        { operation: "replace", source: ["b2"], blocks: [block("r", "R")] },
      ],
      sections: [{ id: first.id, after: "b3" }],
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it("names the block and section a full plan drops a section break for", async () => {
    const snapshot = twoSections();
    const s = setup(snapshot);
    const [first] = snapshot.sections!;
    const readToken = await s.completeRead();
    const execute = createWordDocumentSubmissionExecutor(s.session);
    expect(
      await execute(
        {
          version: 1,
          snapshot: snapshot.token,
          readToken,
          scope: "document",
          entries: snapshot.blocks.map((b) =>
            b.ref === "b2"
              ? { kind: "replace", source: ["b2"], blocks: [block("r", "R")] }
              : { kind: "keep", source: [b.ref] },
          ),
          deleted: [],
        },
        { ...context, toolCallId: "full" },
      ),
    ).toMatchObject({
      ok: false,
      validationErrors: [
        {
          code: "section-order",
          path: "/entries/1/source/0",
          message: expect.stringMatching(
            new RegExp(`^Block b2 ends section ${first.id}\\. `),
          ),
        },
      ],
    });
  });

  it("points a story block the parser rejects at that story change", async () => {
    const s = setup(captureWordAuthoringSnapshot(texts(4), "doc", "Off", true));
    expect(
      await s.sparse(await s.completeRead(), {
        stories: [
          {
            kind: "upsert",
            type: "footnote",
            id: "note",
            anchor: { block: "b2" },
            blocks: [{ id: "h", type: "heading", text: "H", level: 42 }],
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      validationErrors: [
        {
          code: "heading-level",
          path: "/scoped_edit/stories/0/blocks/0/level",
        },
      ],
    });
  });

  it("points an invalid section layout at that section change", async () => {
    const s = setup(captureWordAuthoringSnapshot(texts(4), "doc", "Off", true));
    expect(
      await s.sparse(await s.completeRead(), {
        sections: [
          {
            id: s.snapshot.sections![0].id,
            layout: { orientation: "sideways" },
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      validationErrors: [
        {
          code: "section-shape",
          path: "/scoped_edit/sections/0/layout",
          message: expect.stringMatching(
            /^Invalid layout\. orientation is portrait or landscape/,
          ),
        },
      ],
    });
  });

  it("points an object edit the parser rejects at that object change", async () => {
    const control = (id: number, text: string) =>
      `<w:sdt><w:sdtPr><w:id w:val="${id}"/></w:sdtPr><w:sdtContent><w:r><w:t>${text}</w:t></w:r></w:sdtContent></w:sdt>`;
    const snapshot = captureWordAuthoringSnapshot(
      packageXml(
        paragraph("Before") +
          `<w:p>${control(11, "First")}<w:r><w:t xml:space="preserve"> and </w:t></w:r>${control(12, "Second")}</w:p>`,
      ),
      "doc-controls",
      "Off",
      true,
    );
    const s = setup(snapshot);
    const readToken = await s.completeRead();
    const controls = wordTargetInventory(snapshot).filter(
      (t) => t.kind === "content-control" && t.objectTarget,
    );
    expect(controls.map((t) => t.bodyRef)).toEqual(["b2", "b2"]);
    expect(
      await s.sparse(readToken, {
        objects: [
          {
            ref: controls[0].ref,
            edit: { operation: "update", color: "00FF00" },
          },
          {
            ref: controls[1].ref,
            edit: { operation: "update", color: "#FF0000" },
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      validationErrors: [
        { code: "native-edit-shape", path: "/scoped_edit/objects/1/edit" },
      ],
    });
  });

  it("names an unchanged section by its id", async () => {
    const s = setup(twoSections());
    const [first, second] = s.snapshot.sections!;
    await s.completeRead();
    const { origins } = expandWordScopedSubmission(
      {
        snapshot: s.snapshot.token,
        readToken: s.snapshot.readToken,
        scoped_edit: {
          sections: [{ id: second.id, layout: { orientation: "landscape" } }],
        },
      },
      s.snapshot,
    );
    expect(
      wordScopedIssues(
        [
          { path: "/sections/0/after", code: "c", message: "Kept." },
          { path: "/sections/1/layout", code: "c", message: "Changed." },
        ],
        origins,
      ),
    ).toEqual([
      {
        path: "/scoped_edit",
        code: "c",
        message: `Unchanged section ${first.id}: Kept.`,
      },
      {
        path: "/scoped_edit/sections/0/layout",
        code: "c",
        message: "Changed.",
      },
    ]);
  });

  it("names a kept block by its ref and rewrites plan paths inside a message", async () => {
    const s = setup(readySnapshot(texts(3)));
    await s.completeRead();
    const { origins } = expandWordScopedSubmission(
      {
        snapshot: s.snapshot.token,
        readToken: s.snapshot.readToken,
        scoped_edit: { body: [insert("b1", [block("n", "New")])] },
      },
      s.snapshot,
    );
    expect(
      wordScopedIssues(
        [
          { path: "/entries/0/source/0", code: "c", message: "Kept." },
          {
            path: "/entries/1/blocks/0/text",
            code: "c",
            message:
              "Clashes with /entries/2/source/0 and /entries/1/blocks/0.",
          },
        ],
        origins,
      ),
    ).toEqual([
      { path: "/scoped_edit", code: "c", message: "Unchanged block b1: Kept." },
      {
        path: "/scoped_edit/body/0/blocks/0/text",
        code: "c",
        message:
          "Clashes with unchanged block b2 and /scoped_edit/body/0/blocks/0.",
      },
    ]);
  });
});

describe("a pane without this request's read session", () => {
  const plan = {
    version: 1,
    snapshot: "snap",
    readToken: "token",
    scope: "body",
    entries: [{ kind: "keep", source: ["b1"] }],
  };

  it("says so plainly when the pane never had a session, as after a reload", async () => {
    const session = new WordDocumentReadSession();
    for (const result of [
      await session.execute({ snapshot: "snap", cursor: null }, context),
      await createWordDocumentSubmissionExecutor(session)(plan, context),
    ])
      expect(result).toMatchObject({
        ok: false,
        validationErrors: [{ message: WORD_NO_REQUEST_SESSION_MESSAGE }],
        submissionFeedback: { terminal: true, recovery: "cannot_continue" },
      });
  });

  it("says so plainly when the session belongs to another request", async () => {
    const snapshot = readySnapshot(texts(2));
    const session = new WordDocumentReadSession();
    session.activate(snapshot, context);
    const other = { ...context, messageId: "other" };
    for (const result of [
      await session.execute({ snapshot: snapshot.token }, other),
      await createWordDocumentSubmissionExecutor(session)(
        { ...plan, snapshot: snapshot.token },
        other,
      ),
    ])
      expect(result).toMatchObject({
        ok: false,
        validationErrors: [
          { code: "wrong-request", message: WORD_NO_REQUEST_SESSION_MESSAGE },
        ],
        submissionFeedback: { terminal: true, recovery: "cannot_continue" },
      });
  });

  it("keeps the stopped wording for a stopped request", async () => {
    const session = new WordDocumentReadSession();
    session.activate(readySnapshot(texts(2)), context);
    const controller = new AbortController();
    controller.abort();
    expect(
      await session.execute(
        { snapshot: "snap" },
        { ...context, signal: controller.signal },
      ),
    ).toMatchObject({
      ok: false,
      validationErrors: [
        {
          code: "read-unavailable",
          message: "Document read unavailable or stopped.",
        },
      ],
    });
  });
});
