import {
  compileWordSections,
  compileWordStories,
  extractWordSections,
  extractWordStories,
  parseWordSections,
  parseWordStoryChanges,
  pruneWordStoryReferences,
} from "@erato/frontend/word-review";
import { describe, expect, it } from "vitest";

import {
  packageXml,
  paragraph,
} from "../../../test/mocks/word/authoringFixtures";
import {
  commentedParagraph,
  withComments,
} from "../../../test/mocks/word/commentFixtures";
import { wordDocumentOoxmlToFile } from "../wordDocumentPackage";

import type { FixtureComment } from "../../../test/mocks/word/commentFixtures";
import type {
  WordPlanBlock,
  WordStoryChange,
} from "@erato/frontend/word-review";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const parse = (xml: string) =>
  new DOMParser().parseFromString(xml, "application/xml");
const xml = (node: Node) => new XMLSerializer().serializeToString(node);
const paragraphs = (doc: Document | Element) =>
  Array.from(doc.getElementsByTagNameNS(W, "p"));
function setup() {
  const doc = parse(
    `<pkg:package xmlns:pkg="${PKG}"><pkg:part pkg:name="/_rels/.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml"><pkg:xmlData><Relationships xmlns="${REL}"><Relationship Id="root" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships></pkg:xmlData></pkg:part><pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"><pkg:xmlData><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Alpha beta gamma</w:t></w:r></w:p><w:p><w:r><w:t>Second section</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:left="1440" w:right="1440" w:top="1440" w:bottom="1440"/></w:sectPr></w:body></w:document></pkg:xmlData></pkg:part></pkg:package>`,
  );
  const [first, second] = paragraphs(doc);
  const output = new Map([
    ["n1", first],
    ["n2", second],
  ]);
  return {
    doc,
    output,
    anchors: anchorsOf(output),
    compile: compileIn(doc),
    first,
    second,
  };
}
const anchorsOf = (output: Map<string, Element>) =>
  new Map([...output].map(([id, node]) => [id, [node]]));
const compileIn = (doc: Document) => (blocks: WordPlanBlock[]) =>
  blocks.map((block) => {
    const paragraph = doc.createElementNS(W, "w:p"),
      run = doc.createElementNS(W, "w:r"),
      text = doc.createElementNS(W, "w:t");
    text.setAttributeNS(
      "http://www.w3.org/XML/1998/namespace",
      "xml:space",
      "preserve",
    );
    text.textContent = block.text ?? "";
    run.append(text);
    paragraph.append(run);
    return paragraph;
  });
const block = (text: string): WordPlanBlock => ({
  id: "s1",
  type: "paragraph",
  text,
});
const THREAD: FixtureComment[] = [
  {
    id: "0",
    author: "Maya Krüger",
    initials: "MK",
    date: "2026-09-08T10:15:30Z",
    text: "Clarify beta",
    paraId: "12AB34CD",
    durableId: "23456789",
  },
];
/** A body whose first paragraph holds a comment on "beta". */
function commentedSetup(comments: FixtureComment[] = THREAD) {
  const doc = parse(
    withComments(
      packageXml(
        commentedParagraph(
          "Alpha ",
          "beta",
          " gamma",
          comments.map((c) => c.id),
        ) + paragraph("Second section"),
      ),
      comments,
    ),
  );
  const [first, second] = paragraphs(doc);
  return {
    doc,
    first,
    second,
    compile: compileIn(doc),
    anchors: anchorsOf(
      new Map([
        ["n1", first],
        ["n2", second],
      ]),
    ),
  };
}

describe("structured stories", () => {
  it("creates every plan story family with valid package relationships", () => {
    const { doc, anchors, output, compile, first } = setup();
    const changes: WordStoryChange[] = [
      {
        kind: "upsert",
        type: "header",
        id: "brand",
        blocks: [block("Header")],
      },
      { kind: "upsert", type: "footer", id: "page", blocks: [block("Footer")] },
      {
        kind: "upsert",
        type: "footnote",
        id: "note",
        blocks: [block("Footnote text")],
        anchor: { block: "n2" },
      },
      {
        kind: "upsert",
        type: "endnote",
        id: "end",
        blocks: [block("Endnote text")],
        anchor: { block: "n2" },
      },
    ];
    compileWordStories(doc, changes, compile, anchors);
    compileWordSections(
      doc,
      [
        {
          id: "final",
          source: "section-1",
          headers: { default: "brand" },
          footers: { default: "page" },
        },
      ],
      output,
    );
    const stories = extractWordStories(doc);
    expect(stories.map((s) => s.type).sort()).toEqual([
      "endnote",
      "footer",
      "footnote",
      "header",
    ]);
    expect(first.textContent).toBe("Alpha beta gamma");
    expect(() => wordDocumentOoxmlToFile(xml(doc))).not.toThrow();
  });

  it("refuses to author, edit or delete comments", () => {
    const { doc, anchors, compile } = commentedSetup();
    const before = xml(doc);
    for (const change of [
      {
        kind: "upsert",
        type: "comment",
        id: "review",
        blocks: [block("Clarify")],
        anchor: { block: "n1" },
      },
      { kind: "upsert", type: "comment", id: "comment-0", blocks: [] },
      { kind: "delete", type: "comment", id: "comment-0" },
    ])
      expect(() =>
        compileWordStories(
          doc,
          [change as unknown as WordStoryChange],
          compile,
          anchors,
        ),
      ).toThrow(/comment-story-route/);
    expect(xml(doc)).toBe(before);
  });

  it("edits notes without duplicating anchors and deletes notes/comments with their anchors", () => {
    const { doc, anchors, compile } = setup();
    compileWordStories(
      doc,
      [
        {
          kind: "upsert",
          type: "footnote",
          id: "new-note",
          blocks: [block("Before")],
          anchor: { block: "n1" },
        },
      ],
      compile,
      anchors,
    );
    const source = extractWordStories(doc)[0];
    compileWordStories(
      doc,
      [
        {
          kind: "upsert",
          type: "footnote",
          id: source.id,
          blocks: [block("After")],
        },
      ],
      compile,
      anchors,
    );
    expect(doc.getElementsByTagNameNS(W, "footnoteReference")).toHaveLength(1);
    expect(extractWordStories(doc)[0].text).toBe("After");
    compileWordStories(
      doc,
      [{ kind: "delete", type: "footnote", id: source.id }],
      compile,
      anchors,
    );
    expect(doc.getElementsByTagNameNS(W, "footnoteReference")).toHaveLength(0);
    expect(extractWordStories(doc)).toHaveLength(0);
  });

  it("initializes the first note parts with native separator geometry and settings", () => {
    const { doc, anchors, compile } = setup();
    compileWordStories(
      doc,
      [
        {
          kind: "upsert",
          type: "footnote",
          id: "fresh-footnote",
          blocks: [block("Note")],
          anchor: { block: "n1" },
        },
        {
          kind: "upsert",
          type: "endnote",
          id: "fresh-endnote",
          blocks: [block("End note")],
          anchor: { block: "n2" },
        },
      ],
      compile,
      anchors,
    );
    for (const type of ["footnote", "endnote"]) {
      const part = doc.getElementsByTagNameNS(W, `${type}s`)[0];
      const special = Array.from(part.children).filter((e) =>
        e.hasAttributeNS(W, "type"),
      );
      expect(special).toHaveLength(2);
      for (const node of special) {
        const spacing = node.getElementsByTagNameNS(W, "spacing")[0];
        expect(
          ["after", "line", "lineRule"].map((key) =>
            spacing.getAttributeNS(W, key),
          ),
        ).toEqual(["0", "240", "auto"]);
      }
      const settings = doc.getElementsByTagNameNS(W, `${type}Pr`)[0];
      expect(
        Array.from(settings.children).map((e) => e.getAttributeNS(W, "id")),
      ).toEqual(["-1", "0"]);
    }
    expect(() => wordDocumentOoxmlToFile(xml(doc))).not.toThrow();
  });

  it("prunes a comment when its source text is removed, preserving other stories", () => {
    const { doc, anchors, compile, first } = commentedSetup();
    compileWordStories(
      doc,
      [
        {
          kind: "upsert",
          type: "header",
          id: "h",
          blocks: [block("Keep header")],
        },
      ],
      compile,
      anchors,
    );
    const originalStories = extractWordStories(doc);
    first.remove();
    pruneWordStoryReferences(doc, originalStories);
    expect(extractWordStories(doc).map((s) => s.type)).toEqual(["header"]);
  });

  it("preserves existing unanchored story bodies on a keep-all compile", () => {
    const { doc, anchors, compile } = commentedSetup();
    for (const reference of Array.from(
      doc.getElementsByTagNameNS(W, "commentReference"),
    ))
      reference.remove();
    const before = xml(doc);
    compileWordStories(doc, [], compile, anchors, extractWordStories(doc));
    expect(xml(doc)).toBe(before);
  });

  it("cleans modern comment identity metadata when the associated comment is removed", () => {
    const { doc, first } = commentedSetup();
    const originalStories = extractWordStories(doc);
    first.remove();
    pruneWordStoryReferences(doc, originalStories);
    expect(xml(doc)).not.toContain("12AB34CD");
    expect(xml(doc)).not.toContain("23456789");
    expect(doc.getElementsByTagNameNS(W, "commentReference")).toHaveLength(0);
  });

  it("rejects dangling note references and invalid text offsets before import", () => {
    const { doc, anchors, compile, first } = setup();
    expect(() =>
      compileWordStories(
        doc,
        [
          {
            kind: "upsert",
            type: "footnote",
            id: "n",
            blocks: [block("Note")],
            anchor: { block: "n1", start: 100 },
          },
        ],
        compile,
        anchors,
      ),
    ).toThrow(/outside/);
    const bad = doc.createElementNS(W, "w:footnoteReference");
    bad.setAttributeNS(W, "w:id", "999");
    first.append(bad);
    expect(() => pruneWordStoryReferences(doc)).toThrow(/has no content/);
  });

  it("passes each story part as owner when compiling nested images or hyperlinks", () => {
    const { doc, anchors, compile } = setup();
    const owners: string[] = [];
    compileWordStories(
      doc,
      [{ kind: "upsert", type: "footer", id: "f", blocks: [block("Footer")] }],
      (blocks, owner) => {
        owners.push(owner);
        return compile(blocks);
      },
      anchors,
    );
    expect(owners).toEqual(["/word/footerErato1.xml"]);
  });
});

describe("structured sections and page layout", () => {
  it("clones original section geometry after the root compiler rebuilt its body", () => {
    const { doc, output } = setup();
    const originals = extractWordSections(doc);
    for (const old of Array.from(doc.getElementsByTagNameNS(W, "sectPr")))
      old.remove();
    compileWordSections(
      doc,
      [
        {
          id: "wide",
          source: "section-1",
          after: "n1",
          layout: { orientation: "landscape", columns: 2, columnSpacing: 18 },
        },
        {
          id: "last",
          source: "section-1",
          layout: { pageNumberStart: 10, margins: { left: 54 } },
        },
      ],
      output,
      originals,
    );
    const sections = extractWordSections(doc);
    expect(sections).toHaveLength(2);
    expect(sections[0].afterParagraph).toBe(1);
    expect(sections[0].layout).toMatchObject({
      orientation: "landscape",
      width: 841.9,
      height: 595.3,
      columns: 2,
      columnSpacing: 18,
    });
    expect(sections[1].layout).toMatchObject({
      pageNumberStart: 10,
      margins: { left: 54, right: 72 },
    });
  });

  it("removes old boundaries when a complete one-section plan is given", () => {
    const { doc, output } = setup();
    compileWordSections(
      doc,
      [{ id: "one", after: "n1" }, { id: "two" }],
      output,
    );
    compileWordSections(doc, [{ id: "merged", source: "section-2" }], output);
    expect(extractWordSections(doc)).toHaveLength(1);
    expect(extractWordSections(doc)[0].afterParagraph).toBeUndefined();
  });

  it("does not accidentally inherit the previous section's header after explicit removal", () => {
    const { doc, anchors, output, compile } = setup();
    compileWordStories(
      doc,
      [{ kind: "upsert", type: "header", id: "h", blocks: [block("Header")] }],
      compile,
      anchors,
    );
    compileWordSections(
      doc,
      [
        { id: "one", after: "n1", headers: { default: "h" } },
        { id: "two", headers: { default: null } },
      ],
      output,
    );
    const sections = extractWordSections(doc);
    expect(sections[1].headers.default).toBeDefined();
    const secondHeader = extractWordStories(doc).find(
      (s) => s.id === sections[1].headers.default,
    );
    expect(secondHeader?.text).toBe("");
    expect(() => wordDocumentOoxmlToFile(xml(doc))).not.toThrow();
  });

  it("rejects backwards boundaries, nonexistent references, and impossible margins", () => {
    const { doc, output } = setup();
    expect(() =>
      compileWordSections(
        doc,
        [{ id: "a", after: "n2" }, { id: "b", after: "n1" }, { id: "c" }],
        output,
      ),
    ).toThrow(/output document order/);
    expect(() =>
      compileWordSections(doc, [{ id: "a", source: "missing" }], output),
    ).toThrow(/no longer exists/);
    expect(() =>
      compileWordSections(
        doc,
        [
          {
            id: "a",
            layout: { width: 200, margins: { left: 150, right: 150 } },
          },
        ],
        output,
      ),
    ).toThrow(/leave space/);
  });
});

describe("strict typed story and section parsing", () => {
  const parseBlock = (v: unknown) =>
    typeof v === "object" && v !== null && "type" in v && v.type === "paragraph"
      ? (v as WordPlanBlock)
      : null;
  it("accepts the typed story contract", () => {
    expect(
      parseWordStoryChanges(
        [
          {
            kind: "upsert",
            type: "footnote",
            id: "c",
            blocks: [block("Text")],
            anchor: { block: "n1", start: 3, end: 3 },
          },
        ],
        parseBlock,
      ),
    ).not.toBeNull();
  });
  it.each([
    [{ kind: "delete", type: "footnote", id: "c", blocks: [] }],
    [{ kind: "delete", type: "comment", id: "c" }],
    [{ kind: "upsert", type: "comment", id: "c", blocks: [] }],
    [
      {
        kind: "upsert",
        type: "footnote",
        id: "n",
        blocks: [],
        author: "Erato",
        anchor: { block: "n1" },
      },
    ],
    [
      {
        kind: "upsert",
        type: "footnote",
        id: "n",
        blocks: [],
        initials: "AI",
        anchor: { block: "n1" },
      },
    ],
    [
      {
        kind: "upsert",
        type: "header",
        id: "h",
        blocks: [],
        anchor: { block: "n1" },
      },
    ],
    [
      {
        kind: "upsert",
        type: "footnote",
        id: "c",
        blocks: [],
        anchor: { block: "n1", start: 4, end: 3 },
      },
    ],
    [{ kind: "upsert", type: "footer", id: "f", blocks: [], xml: "<w:p/>" }],
  ])("rejects malformed story intent %j", (changes) => {
    expect(parseWordStoryChanges(changes, parseBlock)).toBeNull();
  });
  it("requires an explicit final section, valid units, and unique boundaries", () => {
    expect(
      parseWordSections([
        {
          id: "last",
          layout: { width: 595, height: 842, orientation: "portrait" },
        },
      ]),
    ).not.toBeNull();
    expect(parseWordSections([])).toBeNull();
    expect(parseWordSections([{ id: "last", after: "n1" }])).toBeNull();
    expect(
      parseWordSections([{ id: "last", layout: { width: -1 } }]),
    ).toBeNull();
    expect(
      parseWordSections([
        { id: "a", after: "n1" },
        { id: "b", after: "n1" },
        { id: "c" },
      ]),
    ).toBeNull();
  });
});
