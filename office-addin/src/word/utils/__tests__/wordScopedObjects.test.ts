import {
  parseWordDocumentPlan,
  validateWordDocumentPlan,
} from "@erato/frontend/word-review";
import { describe, expect, it } from "vitest";

import {
  packageXml,
  paragraph,
  readySnapshot,
} from "../../../test/mocks/word/authoringFixtures";
import { WORD_AUTHORING_CONTRACT } from "../wordAuthoringContract";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
} from "../wordDocumentXml";
import { wordTargetInventory } from "../wordTargetRead";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanBlock,
} from "@erato/frontend/word-review";

const context = { chatId: "chat", messageId: "message", toolCallId: "read" };
function setup(
  snapshot = readySnapshot(
    packageXml(["Before", "Target", "After"].map(paragraph).join("")),
  ),
) {
  const session = new WordDocumentReadSession();
  session.activate(snapshot, context);
  const read = (target: Record<string, unknown>, extra = {}) =>
    session.execute(
      {
        snapshot: snapshot.token,
        documentIdentity: snapshot.identity,
        target,
        ...extra,
      },
      context,
    );
  const submit = createWordDocumentSubmissionExecutor(session);
  let calls = 0;
  return {
    snapshot,
    session,
    read,
    async edit(
      target: Record<string, unknown>,
      scoped_edit: Record<string, unknown>,
    ) {
      const result = await read(target);
      expect(result).toMatchObject({ ok: true, result: { status: "ready" } });
      if (!result.ok) throw Error(result.error);
      const readToken = (result.result as { readToken: string }).readToken;
      return submit(
        { snapshot: snapshot.token, readToken, scoped_edit },
        { ...context, toolCallId: `edit-${++calls}` },
      );
    },
  };
}
const textBlock = (text: string): WordPlanBlock => ({
  id: "new",
  type: "paragraph",
  text,
});
function assertAccepted(
  result: Awaited<ReturnType<ReturnType<typeof setup>["edit"]>>,
  snapshot: WordAuthoringSnapshot,
) {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw Error(result.error);
  const plan = parseWordDocumentPlan(
    JSON.stringify((result.result as { plan: unknown }).plan),
  )!;
  expect(validateWordDocumentPlan(plan, snapshot)).toBeNull();
  const xml = compileWordDocumentPlan(plan, snapshot);
  const after = captureWordAuthoringSnapshot(
    xml,
    snapshot.identity,
    "Off",
    snapshot.fullDocument,
  );
  expect(verifyWordPlanOutput(plan, snapshot, after)).toBe(true);
  expect(snapshot.read.size).toBe(0);
  expect(snapshot.readToken).toBeUndefined();
  return { plan, after, xml };
}
function richSnapshot() {
  const initial = captureWordAuthoringSnapshot(
    packageXml(
      paragraph("Before") + paragraph("Original") + paragraph("After"),
    ),
    "doc-rich",
    "Off",
    true,
  );
  initial.readToken = "fixture";
  const blocks: WordPlanBlock[] = [
    {
      id: "image",
      type: "image",
      text: "",
      image: {
        data: {
          mime: "image/png",
          base64:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        },
        alt: "Logo",
        widthPt: 12,
        heightPt: 12,
      },
    },
    { id: "heading", type: "heading", level: 1, text: "Title" },
    {
      id: "list1",
      type: "list-item",
      text: "First item",
      list: "numbers",
      ordered: true,
      level: 0,
    },
    {
      id: "list2",
      type: "list-item",
      text: "Second item",
      list: "numbers",
      ordered: true,
      level: 0,
    },
    {
      id: "table",
      type: "table",
      text: "",
      columns: [100],
      rows: [
        {
          cells: [
            { blocks: [{ id: "cell", type: "paragraph", text: "Cell" }] },
          ],
        },
      ],
    },
    {
      id: "field",
      type: "field",
      text: "",
      field: { instruction: "DATE", text: "Today" },
    },
    {
      id: "bookmark",
      type: "bookmark",
      text: "",
      bookmark: {
        name: "Mark",
        children: [{ id: "marked", type: "paragraph", text: "Bookmarked" }],
      },
    },
    {
      id: "control",
      type: "content-control",
      text: "",
      control: {
        title: "Customer",
        children: [{ id: "controlled", type: "paragraph", text: "Client" }],
      },
    },
    {
      id: "drawing",
      type: "drawing",
      text: "",
      drawing: { shape: "rect", text: "Box", widthPt: 40, heightPt: 20 },
    },
  ];
  const plan: WordDocumentPlan = {
    version: 1,
    snapshot: initial.token,
    readToken: "fixture",
    scope: "document",
    entries: [
      { kind: "keep", source: ["b1"] },
      { kind: "replace", source: ["b2"], blocks },
      { kind: "keep", source: ["b3"] },
    ],
    deleted: [],
    stories: [
      ...(["header", "footer"] as const).map((type) => ({
        kind: "upsert" as const,
        type,
        id: type,
        blocks: [{ ...textBlock(`${type} text`), id: `${type}-p` }],
      })),
      ...(["footnote", "endnote", "comment"] as const).map((type) => ({
        kind: "upsert" as const,
        type,
        id: type,
        blocks: [{ ...textBlock(`${type} text`), id: `${type}-p` }],
        anchor: {
          block: "b1",
          start: 0,
          ...(type === "comment" ? { end: 3 } : {}),
        },
      })),
    ],
    sections: [
      {
        id: "section-final",
        source: "section-1",
        headers: { default: "header" },
        footers: { default: "footer" },
      },
    ],
  };
  return captureWordAuthoringSnapshot(
    compileWordDocumentPlan(plan, initial),
    initial.identity,
    "Off",
    true,
  );
}

describe("scoped object editing", () => {
  it("returns only relevant guidance and metadata, with explicit guidance for new content", async () => {
    const s = setup();
    s.snapshot.styles = [
      { id: "unused", name: "Unused style", type: "paragraph" },
    ];
    s.snapshot.assets = [
      {
        ref: "asset-1",
        fileId: "private-file",
        name: "Logo",
        mime: "image/png",
        base64: "private-bytes",
        widthPx: 1,
        heightPx: 1,
        sizeBytes: 1,
      },
    ];
    const simple = await s.read({ text: "Target" });
    expect(simple).toMatchObject({
      result: {
        status: "ready",
        styles: [],
        contract: {
          paragraphs: expect.any(String),
          scopedEdit: { body: expect.any(String) },
        },
      },
    });
    const result = (simple as { result: Record<string, unknown> }).result;
    expect(result).not.toHaveProperty("assets");
    for (const key of [
      "table",
      "media",
      "stories",
      "sections",
      "repair",
      "plan",
    ])
      expect(result.contract).not.toHaveProperty(key);
    expect(
      new TextEncoder().encode(JSON.stringify(simple)).length,
    ).toBeLessThan(6500);
    const expanded = await s.read(
      { text: "Target" },
      { include: ["table", "media", "formatting", "stories", "sections"] },
    );
    expect(expanded).toMatchObject({
      result: {
        styles: s.snapshot.styles,
        assets: [{ ref: "asset-1" }],
        contract: {
          table: { creation: expect.any(String) },
          media: { image: expect.any(String) },
          stories: expect.any(String),
          sectionLayout: expect.any(String),
        },
      },
    });
    expect(JSON.stringify(expanded)).not.toContain("private-file");
    expect(JSON.stringify(expanded)).not.toContain("private-bytes");
    expect(s.snapshot.read.size).toBe(0);
    for (const include of [["unknown"], ["table", "table"], "table"])
      expect((await s.read({ ref: "b2" }, { include })).ok).toBe(false);
  });
  it("provides guidance for every existing object family, including nested objects", async () => {
    const s = setup(richSnapshot());
    for (const [kind, group] of [
      ["heading", "paragraphs"],
      ["list-item", "paragraphs"],
      ["table", "table"],
      ["image", "media"],
      ["drawing", "media"],
      ["field", "structures"],
      ["bookmark", "structures"],
      ["content-control", "structures"],
      ["header", "stories"],
      ["footer", "stories"],
      ["footnote", "stories"],
      ["endnote", "stories"],
      ["comment", "stories"],
      ["section", "sectionLayout"],
    ]) {
      const target = wordTargetInventory(s.snapshot).find(
        (t) => t.kind === kind,
      )!;
      expect(target, kind).toBeDefined();
      const read = await s.read({ ref: target.ref });
      expect(read, kind).toMatchObject({
        ok: true,
        result: { status: "ready" },
      });
      expect(
        (read as { result: { contract: unknown } }).result.contract,
      ).toHaveProperty(group);
    }
  });
  it("tells the model under Track Changes that passages with pending revisions stay as they are", async () => {
    const s = setup();
    const plain = await s.read({ text: "Target" });
    expect(
      (plain as { result: { contract: unknown } }).result.contract,
    ).not.toHaveProperty("trackedChanges");
    const tracked = setup();
    tracked.snapshot.trackingMode = "TrackAll";
    const read = await tracked.read({ text: "Target" });
    const contract = (read as { result: { contract: Record<string, unknown> } })
      .result.contract;
    expect(contract.trackedChanges).toBe(
      WORD_AUTHORING_CONTRACT.trackedChanges,
    );
    expect(contract.trackedChanges).toContain(
      "cannot be edited until the user accepts or rejects those changes in Word",
    );
  });
  it("can replace a paragraph with a new table using explicitly requested guidance", async () => {
    const s = setup();
    const read = await s.read({ ref: "b2" }, { include: ["table"] });
    expect(read).toMatchObject({
      result: { contract: { table: { shape: expect.any(String) } } },
    });
    const submit = createWordDocumentSubmissionExecutor(s.session);
    const result = await submit(
      {
        snapshot: s.snapshot.token,
        readToken: (read as { result: { readToken: string } }).result.readToken,
        scoped_edit: {
          body: [
            {
              operation: "replace",
              source: ["b2"],
              blocks: [
                {
                  id: "new-table",
                  type: "table",
                  rows: [
                    {
                      cells: [
                        {
                          blocks: [
                            { id: "cell", type: "paragraph", text: "New cell" },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      { ...context, toolCallId: "replace-table" },
    );
    const { after } = assertAccepted(result, s.snapshot);
    expect(after.blocks.map((b) => b.text)).toEqual([
      "Before",
      "New cell",
      "After",
    ]);
    expect(after.blocks[0].xml).toBe(s.snapshot.blocks[0].xml);
    expect(after.blocks[2].xml).toBe(s.snapshot.blocks[2].xml);
  });
  it("includes guidance and metadata in the scoped response byte budget", async () => {
    const s = setup();
    s.snapshot.styles = Array.from({ length: 1000 }, (_, i) => ({
      id: `style-${i}`,
      name: "A long unused style name",
      type: "paragraph",
    }));
    expect(
      await s.read({ ref: "b2" }, { include: ["formatting"] }),
    ).toMatchObject({
      result: { status: "unsupported", reason: "scope-context-limit" },
    });
    expect(s.snapshot.readScopes?.size).toBe(0);
    expect(await s.read({ ref: "b2" })).toMatchObject({
      result: { status: "ready" },
    });
  });
  it("batches move/delete source and destination discovery into one authorized read", async () => {
    const s = setup();
    const read = await s.read({
      queries: [{ text: "Target" }, { text: "Before" }, { text: "After" }],
    });
    expect(read).toMatchObject({
      result: {
        status: "ready",
        queries: [
          { index: 0, refs: ["b2"] },
          { index: 1, refs: ["b1"] },
          { index: 2, refs: ["b3"] },
        ],
      },
    });
    expect(s.snapshot.readScopes?.size).toBe(1);
    const result = await createWordDocumentSubmissionExecutor(s.session)(
      {
        snapshot: s.snapshot.token,
        readToken: (read as { result: { readToken: string } }).result.readToken,
        scoped_edit: {
          body: [
            { operation: "move-after", source: ["b2"], anchor: "b3" },
            {
              operation: "delete",
              source: ["b1"],
              reason: "Requested deletion",
            },
          ],
        },
      },
      { ...context, toolCallId: "batch-move" },
    );
    const { after } = assertAccepted(result, s.snapshot);
    expect(after.blocks.map((b) => b.text)).toEqual(["After", "Target"]);
    expect(after.blocks.map((b) => b.xml)).toEqual([
      s.snapshot.blocks[2].xml,
      s.snapshot.blocks[1].xml,
    ]);
  });
  it("grants no partial scope for ambiguous, missing or invalid batched selectors", async () => {
    for (const query of [
      { kind: "paragraph" },
      { text: "missing" },
      { refs: ["foreign-ref"] },
      { queries: [{ ref: "b2" }] },
    ]) {
      const s = setup();
      const result = await s.read({ queries: [{ ref: "b1" }, query] });
      expect(JSON.stringify(result)).not.toContain('"readToken"');
      expect(s.snapshot.readScopes?.size).toBe(0);
      expect(s.snapshot.read.size).toBe(0);
    }
    const s = setup();
    const ambiguous = await s.read({
      queries: [{ ref: "b1" }, { kind: "paragraph" }],
    });
    expect(ambiguous).toMatchObject({
      result: {
        status: "ambiguous",
        queries: [{ refs: ["b1"] }, { status: "ambiguous", totalMatches: 3 }],
      },
    });
    expect(
      await s.read({ queries: [{ ref: "b1" }, { ref: "b2" }] }),
    ).toMatchObject({ result: { status: "ready" } });
  });
  it("bounds cumulative batch targets, bytes and candidate snippets", async () => {
    const s = setup(
      readySnapshot(
        packageXml(
          Array.from({ length: 20 }, (_, i) =>
            paragraph(`Target ${i} ` + "x".repeat(1500)),
          ).join(""),
        ),
      ),
    );
    const tooMany = await s.read({
      queries: [{ ref: "b1", throughRef: "b16" }, { ref: "b17" }],
    });
    expect(tooMany).toMatchObject({
      ok: false,
      validationErrors: [{ code: "target-limit" }],
    });
    expect(
      await s.read({ queries: [{ ref: "b1", throughRef: "b16" }] }),
    ).toMatchObject({ result: { status: "unsupported" } });
    const ambiguous = await s.read({
      queries: Array.from({ length: 16 }, () => ({ text: "Target" })),
    });
    expect(ambiguous).toMatchObject({ result: { status: "ambiguous" } });
    expect(
      new TextEncoder().encode(JSON.stringify(ambiguous)).length,
    ).toBeLessThan(24 * 1024);
    const queries = (
      ambiguous as { result: { queries: { candidates: unknown[] }[] } }
    ).result.queries;
    expect(queries.reduce((n, q) => n + q.candidates.length, 0)).toBe(5);
    expect(s.snapshot.readScopes?.size).toBe(0);
    for (const queries of [[], Array(17).fill({ ref: "b1" }), "invalid"])
      expect((await s.read({ queries })).ok).toBe(false);
  });
  it("deduplicates overlapping explicit batch reads without authorizing neighbors", async () => {
    const s = setup();
    const read = await s.read({
      queries: [{ ref: "b1", throughRef: "b2" }, { ref: "b2" }],
    });
    expect(read).toMatchObject({
      result: { status: "ready", targets: [{ ref: "b1" }, { ref: "b2" }] },
    });
    const result = await createWordDocumentSubmissionExecutor(s.session)(
      {
        snapshot: s.snapshot.token,
        readToken: (read as { result: { readToken: string } }).result.readToken,
        scoped_edit: {
          body: [{ operation: "move-after", source: ["b2"], anchor: "b3" }],
        },
      },
      { ...context, toolCallId: "outside-batch" },
    );
    expect(result.ok).toBe(false);
  });
  it("binds batches to document, snapshot, fingerprint and request", async () => {
    for (const extra of [
      { snapshot: "old" },
      { documentIdentity: "another-document" },
    ]) {
      const s = setup();
      expect((await s.read({ queries: [{ ref: "b2" }] }, extra)).ok).toBe(
        false,
      );
      expect(s.snapshot.readScopes?.size).toBe(0);
    }
    for (const changed of [
      "fingerprint",
      "identity",
      "request",
      "revoked",
    ] as const) {
      const s = setup();
      const read = await s.read({ queries: [{ ref: "b1" }, { ref: "b2" }] });
      if (changed === "revoked") s.snapshot.revoked = true;
      else if (changed !== "request") s.snapshot[changed] += "changed";
      const result = await createWordDocumentSubmissionExecutor(s.session)(
        {
          snapshot: s.snapshot.token,
          readToken: (read as { result: { readToken: string } }).result
            .readToken,
          scoped_edit: {
            body: [
              {
                operation: "delete",
                source: ["b2"],
                reason: "Requested deletion",
              },
            ],
          },
        },
        {
          ...context,
          toolCallId: "stale-batch",
          ...(changed === "request" ? { messageId: "another-request" } : {}),
        },
      );
      expect(result.ok).toBe(false);
    }
  });
  it("replaces one paragraph without reading or changing its neighbors", async () => {
    const s = setup();
    const result = await s.edit(
      { kind: "paragraph", text: "Target" },
      {
        body: [
          {
            operation: "replace",
            source: ["b2"],
            blocks: [textBlock("Changed")],
          },
        ],
      },
    );
    const { after, plan } = assertAccepted(result, s.snapshot);
    expect(after.blocks.map((b) => b.text)).toEqual([
      "Before",
      "Changed",
      "After",
    ]);
    expect(after.blocks[0].xml).toBe(s.snapshot.blocks[0].xml);
    expect(after.blocks[2].xml).toBe(s.snapshot.blocks[2].xml);
    const tampered = globalThis.structuredClone(plan);
    tampered.entries[0] = {
      kind: "replace",
      source: ["b1"],
      blocks: [{ ...textBlock("Hidden write"), id: "evil" }],
    };
    expect(validateWordDocumentPlan(tampered, s.snapshot)).toBe("incomplete");
  });
  it("pages ambiguity without granting scope and supports explicit disambiguation", async () => {
    const s = setup(
      readySnapshot(
        packageXml(
          Array.from({ length: 12 }, () => paragraph("Same")).join(""),
        ),
      ),
    );
    const first = await s.read({ text: "Same" });
    expect(first).toMatchObject({
      ok: true,
      result: { status: "ambiguous", totalMatches: 12, nextOffset: 5 },
    });
    expect(s.snapshot.readScopes?.size).toBe(0);
    expect(await s.read({ text: "Same", offset: 5 })).toMatchObject({
      result: {
        candidates: [
          { ref: "b6" },
          { ref: "b7" },
          { ref: "b8" },
          { ref: "b9" },
          { ref: "b10" },
        ],
      },
    });
    expect(await s.read({ ref: "b8" })).toMatchObject({
      result: { status: "ready" },
    });
  });
  it("signals repeated missing searches, rejects wrong document and expired reads", async () => {
    const s = setup();
    await s.read({ text: "Missing" });
    expect(await s.read({ text: "Missing" })).toMatchObject({
      result: { status: "not-found", repeatedQuery: true },
    });
    expect(
      (await s.read({ ref: "b1" }, { documentIdentity: "other" })).ok,
    ).toBe(false);
    expect((await s.read({ ref: "b1" }, { snapshot: "old" })).ok).toBe(false);
    s.snapshot.revoked = true;
    expect((await s.read({ ref: "b1" })).ok).toBe(false);
  });
  it("bounds context independently of document length and grants no scope for oversized targets", async () => {
    const s = setup(
      readySnapshot(
        packageXml(
          paragraph("needle") +
            Array.from({ length: 1000 }, () => paragraph("Filler")).join(""),
        ),
      ),
    );
    const result = await s.read({ text: "needle" });
    expect(result).toMatchObject({
      result: { status: "ready", targets: [{ ref: "b1" }] },
    });
    expect(JSON.stringify(result).length).toBeLessThan(22000);
    const huge = setup(
      readySnapshot(packageXml(paragraph("huge " + "x".repeat(25000)))),
    );
    expect(await huge.read({ text: "huge" })).toMatchObject({
      result: { status: "unsupported", reason: "scope-context-limit" },
    });
    expect(huge.snapshot.readScopes?.size).toBe(0);
  });
  it("rejects writes and source reuse outside the selected scope", async () => {
    for (const change of [
      { body: [{ operation: "delete", source: ["b1"], reason: "Wrong" }] },
      { body: [{ operation: "move-before", source: ["b2"], anchor: "b1" }] },
      {
        body: [
          {
            operation: "replace",
            source: ["b2"],
            blocks: [
              { id: "n", type: "native-edit", sourceRef: "b1", edits: [] },
            ],
          },
        ],
      },
    ]) {
      const s = setup();
      expect((await s.edit({ ref: "b2" }, change)).ok).toBe(false);
    }
  });
  it("moves exact sources with read destination and inserts/deletes bounded ranges", async () => {
    const s = setup();
    const moved = assertAccepted(
      await s.edit(
        { refs: ["b1", "b3"] },
        { body: [{ operation: "move-before", source: ["b3"], anchor: "b1" }] },
      ),
      s.snapshot,
    );
    expect(moved.after.blocks.map((b) => b.text)).toEqual([
      "After",
      "Before",
      "Target",
    ]);
    expect(moved.after.blocks[0].xml).toBe(s.snapshot.blocks[2].xml);
    const t = setup();
    const replaced = assertAccepted(
      await t.edit(
        { ref: "b1", throughRef: "b2" },
        {
          body: [
            {
              operation: "replace",
              source: ["b1", "b2"],
              blocks: [textBlock("Combined")],
            },
          ],
        },
      ),
      t.snapshot,
    );
    expect(replaced.after.blocks.map((b) => b.text)).toEqual([
      "Combined",
      "After",
    ]);
    const u = setup();
    const changed = assertAccepted(
      await u.edit(
        { refs: ["b1", "b2"] },
        {
          body: [
            {
              operation: "delete",
              source: ["b2"],
              reason: "Requested removal",
            },
            {
              operation: "insert-after",
              anchor: "b1",
              blocks: [textBlock("Inserted")],
            },
          ],
        },
      ),
      u.snapshot,
    );
    expect(changed.after.blocks.map((b) => b.text)).toEqual([
      "Before",
      "Inserted",
      "After",
    ]);
  });
  it.each(["field", "bookmark", "content-control", "drawing", "image"])(
    "updates one native %s while retaining surrounding sources",
    async (kind) => {
      const s = setup(richSnapshot());
      expect(s.snapshot.issue).toBeUndefined();
      const target = wordTargetInventory(s.snapshot).find(
        (t) => t.kind === kind && t.objectTarget,
      )!;
      expect(target).toBeDefined();
      const properties =
        kind === "field"
          ? { text: "Tomorrow" }
          : kind === "bookmark"
            ? { name: "Renamed" }
            : kind === "content-control"
              ? { title: "Renamed" }
              : kind === "image"
                ? { image: { alt: "Changed logo", widthPt: 24 } }
                : { drawing: { text: "Changed box" } };
      const { after } = assertAccepted(
        await s.edit(
          { ref: target.ref },
          {
            objects: [
              { ref: target.ref, edit: { operation: "update", ...properties } },
            ],
          },
        ),
        s.snapshot,
      );
      s.snapshot.blocks.forEach((block, i) => {
        if (block.ref !== target.bodyRef)
          expect(after.blocks[i].xml).toBe(block.xml);
      });
    },
  );
  it.each(["header", "footer", "footnote", "endnote", "comment"])(
    "edits %s with bounded story context",
    async (kind) => {
      const s = setup(richSnapshot());
      const target = wordTargetInventory(s.snapshot).find(
        (t) => t.kind === kind,
      )!;
      const { after } = assertAccepted(
        await s.edit(
          { ref: target.ref },
          {
            stories: [
              {
                kind: "upsert",
                type: kind,
                id: target.storyId,
                blocks: [textBlock("Revised story")],
              },
            ],
          },
        ),
        s.snapshot,
      );
      expect(
        after.stories?.find((story) => story.id === target.storyId)?.text,
      ).toBe("Revised story");
      expect(after.blocks.map((b) => b.xml)).toEqual(
        s.snapshot.blocks.map((b) => b.xml),
      );
      s.snapshot.stories?.forEach((story) => {
        if (story.id !== target.storyId)
          expect(after.stories?.find((v) => v.id === story.id)?.xml).toBe(
            story.xml,
          );
      });
    },
  );
  it("updates section layout without requiring body reads", async () => {
    const s = setup(richSnapshot());
    const target = wordTargetInventory(s.snapshot).find(
      (t) => t.kind === "section",
    )!;
    const { after } = assertAccepted(
      await s.edit(
        { ref: target.ref },
        {
          sections: [
            { id: target.sectionId, layout: { orientation: "landscape" } },
          ],
        },
      ),
      s.snapshot,
    );
    expect(after.sections?.[0].layout.orientation).toBe("landscape");
    expect(after.blocks.map((b) => b.text)).toEqual(
      s.snapshot.blocks.map((b) => b.text),
    );
  });
  it("does not weaken complete-read authorization", async () => {
    const s = setup();
    await s.read({ ref: "b2" });
    const result = await s.session.execute(
      { snapshot: s.snapshot.token },
      context,
    );
    expect(result).toMatchObject({ ok: true, result: { complete: true } });
    expect(s.snapshot.read.size).toBe(3);
  });
  it("edits a heading, continues an existing list and patches table structure", async () => {
    const h = setup(richSnapshot());
    const heading = h.snapshot.blocks.find((b) => b.type === "heading")!;
    const headingResult = assertAccepted(
      await h.edit(
        { ref: heading.ref },
        {
          body: [
            {
              operation: "replace",
              source: [heading.ref],
              blocks: [
                { id: "h", type: "heading", level: 2, text: "Revised title" },
              ],
            },
          ],
        },
      ),
      h.snapshot,
    );
    expect(
      headingResult.after.blocks.find((b) => b.text === "Revised title")?.level,
    ).toBe(2);
    const l = setup(richSnapshot());
    const item = l.snapshot.blocks
      .filter((b) => b.type === "list-item")
      .at(-1)!;
    const listResult = assertAccepted(
      await l.edit(
        { ref: item.ref },
        {
          body: [
            {
              operation: "insert-after",
              anchor: item.ref,
              blocks: [
                {
                  id: "item",
                  type: "list-item",
                  text: "Third item",
                  list: item.list,
                  level: item.level,
                  ordered: item.ordered,
                },
              ],
            },
          ],
        },
      ),
      l.snapshot,
    );
    const items = listResult.after.blocks.filter((b) => b.type === "list-item");
    expect(items.map((b) => b.text)).toEqual([
      "First item",
      "Second item",
      "Third item",
    ]);
    expect(new Set(items.map((b) => b.list)).size).toBe(1);
    const t = setup(richSnapshot());
    const table = t.snapshot.blocks.find((b) => b.content)!;
    const tableResult = assertAccepted(
      await t.edit(
        { ref: table.ref },
        {
          body: [
            {
              operation: "replace",
              source: [table.ref],
              blocks: [
                {
                  id: "t",
                  type: "table",
                  sourceRef: table.ref,
                  columns: [120],
                  rows: [
                    { sourceIndex: 0, cells: [{ sourceIndex: 0 }] },
                    { cells: [{ blocks: [textBlock("New row")] }] },
                  ],
                },
              ],
            },
          ],
        },
      ),
      t.snapshot,
    );
    expect(
      tableResult.after.blocks.find((b) => b.content)?.content?.rows,
    ).toHaveLength(2);
    expect(
      tableResult.after.blocks.find((b) => b.content)?.content?.rows[0].cells[0]
        .text,
    ).toBe("Cell");
  });
  it("creates and deletes notes/comments with explicitly read anchors", async () => {
    for (const type of ["footnote", "endnote", "comment"] as const) {
      const s = setup(
        captureWordAuthoringSnapshot(
          packageXml(paragraph("Anchor") + paragraph("Untouched")),
          "doc",
          "Off",
          true,
        ),
      );
      const added = assertAccepted(
        await s.edit(
          { ref: "b1" },
          {
            stories: [
              {
                kind: "upsert",
                type,
                id: "new-note",
                blocks: [textBlock("New annotation")],
                anchor: {
                  block: "b1",
                  start: 0,
                  ...(type === "comment" ? { end: 3 } : {}),
                },
              },
            ],
          },
        ),
        s.snapshot,
      );
      expect(added.after.stories?.[0].text).toBe("New annotation");
      const d = setup(added.after);
      const story = wordTargetInventory(d.snapshot).find(
        (t) => t.kind === type,
      )!;
      const read = await d.read({ ref: story.ref });
      expect(read).toMatchObject({
        result: {
          targets: [{ content: { anchors: [{ ref: "b1", text: "Anchor" }] } }],
        },
      });
      const removed = assertAccepted(
        await d.edit(
          { ref: story.ref },
          { stories: [{ kind: "delete", type, id: story.storyId }] },
        ),
        d.snapshot,
      );
      expect(removed.after.stories).toHaveLength(0);
      expect(removed.after.blocks.map((b) => b.text)).toEqual([
        "Anchor",
        "Untouched",
      ]);
    }
  });
  it("splits and merges sections only after reading the affected boundaries", async () => {
    const s = setup(
      captureWordAuthoringSnapshot(
        packageXml(["Before", "Boundary", "After"].map(paragraph).join("")),
        "doc",
        "Off",
        true,
      ),
    );
    const split = assertAccepted(
      await s.edit(
        { refs: ["section-1", "b2"] },
        {
          sections: [
            {
              id: "new-section",
              after: "b2",
              layout: { orientation: "landscape" },
            },
          ],
        },
      ),
      s.snapshot,
    );
    expect(split.after.sections).toHaveLength(2);
    const d = setup(split.after);
    const ids = d.snapshot.sections!.map((section) => section.id);
    expect(
      (
        await d.edit(
          { ref: ids[0] },
          { sections: [{ id: ids[0], delete: true }] },
        )
      ).ok,
    ).toBe(false);
    const merged = assertAccepted(
      await d.edit({ refs: ids }, { sections: [{ id: ids[0], delete: true }] }),
      d.snapshot,
    );
    expect(merged.after.sections).toHaveLength(1);
    expect(merged.after.blocks.map((b) => b.text)).toEqual([
      "Before",
      "Boundary",
      "After",
    ]);
  });
  it("creates a header with its selected section association", async () => {
    const s = setup(
      captureWordAuthoringSnapshot(
        packageXml(paragraph("Body")),
        "doc",
        "Off",
        true,
      ),
    );
    const result = assertAccepted(
      await s.edit(
        { ref: "section-1" },
        {
          stories: [
            {
              kind: "upsert",
              type: "header",
              id: "new-header",
              blocks: [textBlock("Brand")],
            },
          ],
          sections: [{ id: "section-1", headers: { default: "new-header" } }],
        },
      ),
      s.snapshot,
    );
    expect(result.after.stories?.[0].text).toBe("Brand");
    expect(result.after.sections?.[0].headers.default).toBe(
      result.after.stories?.[0].id,
    );
  });
  it("can explicitly make a new selected section final", async () => {
    const s = setup(
      captureWordAuthoringSnapshot(
        packageXml(paragraph("Before") + paragraph("After")),
        "doc",
        "Off",
        true,
      ),
    );
    const result = assertAccepted(
      await s.edit(
        { refs: ["section-1", "b1"] },
        {
          sections: [
            { id: "section-1", after: "b1" },
            {
              id: "new-final",
              after: null,
              layout: { orientation: "landscape" },
            },
          ],
        },
      ),
      s.snapshot,
    );
    expect(result.after.sections).toHaveLength(2);
    expect(result.after.sections?.[1].layout.orientation).toBe("landscape");
  });
  it("keeps scoped reads available after a complete-read budget failure", async () => {
    const s = setup();
    s.session.activate(s.snapshot, context, async () => "model-budget");
    expect(
      await s.session.execute({ snapshot: s.snapshot.token }, context),
    ).toMatchObject({
      ok: false,
      validationErrors: [{ code: "model-budget" }],
    });
    expect(await s.read({ ref: "b2" })).toMatchObject({
      result: { status: "ready" },
    });
    expect(s.snapshot.issue).toBeUndefined();
  });
  it("rejects an issued scope after identity, fingerprint or request changes", async () => {
    for (const mutation of [
      "identity",
      "fingerprint",
      "ownerMessageId",
    ] as const) {
      const s = setup();
      const result = await s.read({ ref: "b2" });
      if (!result.ok) throw Error(result.error);
      s.snapshot[mutation] = "changed";
      const submit = createWordDocumentSubmissionExecutor(s.session);
      expect(
        (
          await submit(
            {
              snapshot: s.snapshot.token,
              readToken: (result.result as { readToken: string }).readToken,
              scoped_edit: {
                body: [
                  { operation: "delete", source: ["b2"], reason: "Removal" },
                ],
              },
            },
            context,
          )
        ).ok,
      ).toBe(false);
    }
  });
});
