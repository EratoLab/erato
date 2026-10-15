import {
  extractWordStories,
  pruneWordStoryReferences,
  wordPlanCommentRemovals,
  wordPlanCommentThreads,
  wordSourceReadRefs,
} from "@erato/frontend/word-review";
import { describe, expect, it } from "vitest";

import {
  packageXml,
  paragraph,
} from "../../../test/mocks/word/authoringFixtures";
import {
  CHAPTER_COMMENTS,
  FIXTURE_ME,
  chapterCommentsBody,
  commentEnd,
  commentStart,
  withComments,
} from "../../../test/mocks/word/commentFixtures";
import { parseWordXml } from "../wordDocumentPackageCodec";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
} from "../wordDocumentXml";
import { wordPlanCommentConsequences } from "../wordPlanComments";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanBlock,
} from "@erato/frontend/word-review";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";

function snapshotOf(xml: string): WordAuthoringSnapshot {
  const snapshot = captureWordAuthoringSnapshot(xml, "doc-A", "Off", true);
  snapshot.read = new Set(wordSourceReadRefs(snapshot));
  snapshot.readToken = "read-proof";
  expect(snapshot.issue).toBeUndefined();
  return snapshot;
}
const chapters = () =>
  snapshotOf(withComments(packageXml(chapterCommentsBody()), CHAPTER_COMMENTS));
const text = (id: string, value: string): WordPlanBlock => ({
  id,
  type: "paragraph",
  text: value,
});

/** Keeps everything but `refs`, which become `blocks`. */
function replacePlan(
  snapshot: WordAuthoringSnapshot,
  refs: string[],
  blocks: WordPlanBlock[],
): WordDocumentPlan {
  const all = snapshot.blocks.map((b) => b.ref);
  const at = all.indexOf(refs[0]);
  return {
    version: 1,
    snapshot: snapshot.token,
    readToken: "read-proof",
    scope: "document",
    entries: [
      ...(at > 0 ? [{ kind: "keep" as const, source: all.slice(0, at) }] : []),
      { kind: "replace", source: refs, blocks },
      ...(at + refs.length < all.length
        ? [{ kind: "keep" as const, source: all.slice(at + refs.length) }]
        : []),
    ],
    deleted: [],
  };
}
const shortenChapter3 = (snapshot: WordAuthoringSnapshot) =>
  replacePlan(
    snapshot,
    ["b6", "b7", "b8", "b9"],
    [text("short", "Chapter three, in short.")],
  );

function compiled(snapshot: WordAuthoringSnapshot, plan: WordDocumentPlan) {
  const xml = compileWordDocumentPlan(plan, snapshot);
  const prepared = captureWordAuthoringSnapshot(
    xml,
    snapshot.identity,
    "Off",
    true,
    "verify",
  );
  return { xml, prepared, doc: parseWordXml(xml) };
}
const part = (doc: Document, name: string) =>
  Array.from(doc.getElementsByTagNameNS(PKG, "part")).find(
    (p) => p.getAttributeNS(PKG, "name") === name,
  );
const serialize = (node: Node | undefined) =>
  node ? new XMLSerializer().serializeToString(node) : "";

describe("comment threads in a package", () => {
  it("groups replies under their root in document order, with status, quote and Comment.id", () => {
    const threads = wordPlanCommentThreads(parseWordXml(chapters().ooxml));
    expect(
      threads.map((t) => ({
        wId: t.wId,
        commentId: t.commentId,
        author: t.author,
        resolved: t.resolved,
        quote: t.quote,
        replies: t.replies.map((r) => [r.wId, r.author, r.commentId]),
      })),
    ).toEqual([
      {
        wId: "0",
        commentId: String(0x6d5c0001),
        author: "Maya Krüger",
        resolved: false,
        quote: "twelve percent",
        replies: [
          ["1", FIXTURE_ME, String(0x6d5c0002)],
          ["2", "Lee Chen", String(0x6d5c0003)],
        ],
      },
      {
        wId: "3",
        commentId: String(0x6d5c0004),
        author: "Lee Chen",
        resolved: true,
        quote: "KPI",
        replies: [["4", "Maya Krüger", String(0x6d5c0005)]],
      },
      {
        wId: "5",
        commentId: String(0x6d5c0006),
        author: FIXTURE_ME,
        resolved: false,
        quote: "second pilot",
        replies: [],
      },
    ]);
  });

  it("reads a legacy file's comments as threads of one, without ids", () => {
    const threads = wordPlanCommentThreads(
      parseWordXml(
        withComments(packageXml(chapterCommentsBody()), CHAPTER_COMMENTS, {
          legacy: true,
        }),
      ),
    );
    expect(threads).toHaveLength(6);
    expect(threads.every((t) => !t.replies.length && !t.commentId)).toBe(true);
  });

  it("quotes a multi-paragraph anchor across its paragraphs, and leaves hidden and deleted text out", () => {
    const threads = wordPlanCommentThreads(
      parseWordXml(
        withComments(
          packageXml(
            commentStart("One ", "two", "0") +
              `<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden </w:t></w:r><w:del w:id="9" w:author="A"><w:r><w:delText>gone </w:delText></w:r></w:del><w:r><w:t>three</w:t></w:r></w:p>` +
              commentEnd("four", " five", "0"),
          ),
          [CHAPTER_COMMENTS[0]],
        ),
      ),
    );
    expect(threads[0].quote).toBe("two three four");
  });
});

describe("threads a plan removes", () => {
  it("names one row per thread, the user's own included, and never a reply", () => {
    const snapshot = chapters();
    const { doc } = compiled(snapshot, shortenChapter3(snapshot));
    const removals = wordPlanCommentRemovals(
      wordPlanCommentThreads(parseWordXml(snapshot.ooxml)),
      doc,
    );
    expect(
      removals.map(({ thread, cause }) => [
        thread.author,
        thread.resolved,
        thread.replies.length,
        thread.quote,
        cause,
      ]),
    ).toEqual([
      ["Lee Chen", true, 1, "KPI", "anchor"],
      [FIXTURE_ME, false, 0, "second pilot", "anchor"],
    ]);
  });

  it("deletes whole threads: no reply survives as a thread of its own, and nothing else changes", () => {
    const snapshot = chapters();
    const before = parseWordXml(snapshot.ooxml);
    const { doc } = compiled(snapshot, shortenChapter3(snapshot));
    const ids = (d: Document) =>
      Array.from(d.getElementsByTagNameNS(W, "comment")).map((c) =>
        c.getAttributeNS(W, "id"),
      );
    expect(ids(doc)).toEqual(["0", "1", "2"]);
    for (const mark of [
      "commentRangeStart",
      "commentRangeEnd",
      "commentReference",
    ])
      expect(
        Array.from(doc.getElementsByTagNameNS(W, mark)).map((m) =>
          m.getAttributeNS(W, "id"),
        ),
      ).toEqual(["0", "1", "2"]);
    const paraIds = new Set(
      Array.from(doc.getElementsByTagNameNS(W, "comment")).map(
        (c) =>
          c.getElementsByTagNameNS(W, "p")[0].getAttributeNS(W14, "paraId")!,
      ),
    );
    const entries = Array.from(doc.getElementsByTagNameNS(W15, "commentEx"));
    expect(entries.map((e) => e.getAttributeNS(W15, "paraId"))).toEqual([
      ...paraIds,
    ]);
    for (const entry of entries) {
      const parent = entry.getAttributeNS(W15, "paraIdParent");
      if (parent) expect(paraIds.has(parent)).toBe(true);
    }
    for (const removed of ["1A000004", "1A000005", "1A000006"])
      expect(serialize(doc)).not.toContain(removed);
    for (const removed of ["6D5C0004", "6D5C0005", "6D5C0006"])
      expect(serialize(doc)).not.toContain(removed);
    expect(wordPlanCommentThreads(doc).map((t) => t.replies.length)).toEqual([
      2,
    ]);
    const kept = (d: Document) =>
      Array.from(d.getElementsByTagNameNS(W, "comment"))
        .filter((c) => ["0", "1", "2"].includes(c.getAttributeNS(W, "id")!))
        .map(serialize);
    expect(kept(doc)).toEqual(kept(before));
    expect(serialize(part(doc, "/word/people.xml"))).toBe(
      serialize(part(before, "/word/people.xml")),
    );
  });

  it("removes a thread whose reply alone lost its anchor, rather than leave the rest behind", () => {
    const doc = parseWordXml(
      withComments(
        packageXml(
          `<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Anchor</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>` +
            `<w:p><w:commentRangeStart w:id="1"/><w:r><w:t>Tail</w:t></w:r><w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p>`,
        ),
        CHAPTER_COMMENTS.slice(0, 2),
      ),
    );
    const original = extractWordStories(doc);
    doc.getElementsByTagNameNS(W, "p")[1].remove();
    pruneWordStoryReferences(doc, original);
    expect(doc.getElementsByTagNameNS(W, "comment")).toHaveLength(0);
    expect(doc.getElementsByTagNameNS(W, "commentRangeStart")).toHaveLength(0);
    expect(doc.getElementsByTagNameNS(W15, "commentEx")).toHaveLength(0);
  });

  it("names a thread whose marks stay around no text, which Word deletes on its own", () => {
    const xml = withComments(
      packageXml(
        commentStart("Before ", "", "5") +
          paragraph("Only anchored text") +
          commentEnd("", "After", "5"),
      ),
      [CHAPTER_COMMENTS[5]],
    );
    const before = parseWordXml(xml);
    const after = parseWordXml(xml);
    after.getElementsByTagNameNS(W, "p")[1].remove();
    expect(
      wordPlanCommentRemovals(wordPlanCommentThreads(before), after).map(
        (r) => [r.thread.author, r.thread.quote, r.cause],
      ),
    ).toEqual([[FIXTURE_ME, "Only anchored text", "text"]]);
  });

  it("names nothing for a plan that leaves every anchor's text, or for a document without comments", () => {
    const snapshot = chapters();
    const plan = replacePlan(snapshot, ["b2"], [text("one", "New text.")]);
    const { xml, prepared } = compiled(snapshot, plan);
    expect(
      wordPlanCommentConsequences(snapshot, xml, prepared).removals,
    ).toEqual([]);
    const plain = snapshotOf(packageXml(paragraph("No comments")));
    expect(
      wordPlanCommentConsequences(plain, plain.ooxml, plain),
    ).toMatchObject({ removals: [], threads: [] });
  });

  it("binds consequences to the compiled plan's fingerprint", () => {
    const snapshot = chapters();
    const a = compiled(snapshot, shortenChapter3(snapshot));
    const b = compiled(
      snapshot,
      replacePlan(snapshot, ["b6", "b7", "b8", "b9"], [text("x", "Other.")]),
    );
    const first = wordPlanCommentConsequences(snapshot, a.xml, a.prepared);
    expect(first.fingerprint).toBe(a.prepared.fingerprint);
    expect(
      wordPlanCommentConsequences(snapshot, a.xml, a.prepared).fingerprint,
    ).toBe(first.fingerprint);
    expect(
      wordPlanCommentConsequences(snapshot, b.xml, b.prepared).fingerprint,
    ).not.toBe(first.fingerprint);
  });
});
