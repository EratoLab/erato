import { describe, expect, it } from "vitest";

import { wordDocumentOoxmlToFile } from "../wordDocumentPackage";
import {
  compileWordSections,
  compileWordStories,
  extractWordSections,
  extractWordStories,
  parseWordSections,
  parseWordStoryChanges,
  pruneWordStoryReferences,
} from "../wordStories";

import type { WordPlanBlock } from "../wordDocumentPlan";
import type { WordStoryChange } from "../wordStories";

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
  const compile = (blocks: WordPlanBlock[]) =>
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
  return { doc, output, compile, first, second };
}
const block = (text: string): WordPlanBlock => ({
  id: "s1",
  type: "paragraph",
  text,
});

describe("structured stories", () => {
  it("creates all story families, exact comment anchors, and valid package relationships", () => {
    const { doc, output, compile, first } = setup();
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
      {
        kind: "upsert",
        type: "comment",
        id: "review",
        author: "Reviewer",
        blocks: [block("Clarify beta")],
        anchor: { block: "n1", start: 6, end: 10 },
      },
    ];
    compileWordStories(doc, changes, compile, output);
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
      "comment",
      "endnote",
      "footer",
      "footnote",
      "header",
    ]);
    expect(stories.find((s) => s.type === "comment")?.author).toBe("Reviewer");
    const children = Array.from(first.children);
    const start = children.findIndex(
      (e) => e.localName === "commentRangeStart",
    );
    const end = children.findIndex((e) => e.localName === "commentRangeEnd");
    expect(
      children
        .slice(start + 1, end)
        .map((e) => e.textContent)
        .join(""),
    ).toBe("beta");
    expect(first.textContent).toBe("Alpha beta gamma");
    expect(first.getElementsByTagNameNS(W, "b")).toHaveLength(3);
    expect(() => wordDocumentOoxmlToFile(xml(doc))).not.toThrow();
  });

  it("edits notes without duplicating anchors and deletes notes/comments with their anchors", () => {
    const { doc, output, compile } = setup();
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
      output,
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
      output,
    );
    expect(doc.getElementsByTagNameNS(W, "footnoteReference")).toHaveLength(1);
    expect(extractWordStories(doc)[0].text).toBe("After");
    compileWordStories(
      doc,
      [{ kind: "delete", type: "footnote", id: source.id }],
      compile,
      output,
    );
    expect(doc.getElementsByTagNameNS(W, "footnoteReference")).toHaveLength(0);
    expect(extractWordStories(doc)).toHaveLength(0);
  });

  it("initializes the first note parts with native separator geometry and settings", () => {
    const { doc, output, compile } = setup();
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
      output,
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
    const { doc, output, compile, first } = setup();
    compileWordStories(
      doc,
      [
        {
          kind: "upsert",
          type: "comment",
          id: "c",
          blocks: [block("Review")],
          anchor: { block: "n1" },
        },
        {
          kind: "upsert",
          type: "header",
          id: "h",
          blocks: [block("Keep header")],
        },
      ],
      compile,
      output,
    );
    const originalStories = extractWordStories(doc);
    first.remove();
    pruneWordStoryReferences(doc, originalStories);
    expect(extractWordStories(doc).map((s) => s.type)).toEqual(["header"]);
  });

  it("preserves existing unanchored story bodies on a keep-all compile", () => {
    const { doc, output, compile } = setup();
    compileWordStories(
      doc,
      [
        {
          kind: "upsert",
          type: "comment",
          id: "c",
          blocks: [block("Unanchored legacy comment")],
          anchor: { block: "n1" },
        },
      ],
      compile,
      output,
    );
    for (const reference of Array.from(
      doc.getElementsByTagNameNS(W, "commentReference"),
    ))
      reference.remove();
    const before = xml(doc);
    compileWordStories(doc, [], compile, output, extractWordStories(doc));
    expect(xml(doc)).toBe(before);
  });

  it("cleans modern comment identity metadata when the associated comment is removed", () => {
    const { doc, output, compile } = setup();
    compileWordStories(
      doc,
      [
        {
          kind: "upsert",
          type: "comment",
          id: "c",
          blocks: [block("Modern comment")],
          anchor: { block: "n1" },
        },
      ],
      compile,
      output,
    );
    const comment = doc.getElementsByTagNameNS(W, "comment")[0];
    paragraphs(comment)[0].setAttributeNS(
      "http://schemas.microsoft.com/office/word/2010/wordml",
      "w14:paraId",
      "12AB34CD",
    );
    const parts = [
      '<pkg:part pkg:name="/word/commentsExtended.xml" pkg:contentType="application/vnd.ms-word.commentsExtended+xml"><pkg:xmlData><w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:commentEx w15:paraId="12AB34CD" w15:done="0"/></w15:commentsEx></pkg:xmlData></pkg:part>',
      '<pkg:part pkg:name="/word/commentsIds.xml" pkg:contentType="application/vnd.ms-word.commentsIds+xml"><pkg:xmlData><w16cid:commentsIds xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid"><w16cid:commentId w16cid:paraId="12AB34CD" w16cid:durableId="23456789"/></w16cid:commentsIds></pkg:xmlData></pkg:part>',
      '<pkg:part pkg:name="/word/commentsExtensible.xml" pkg:contentType="application/vnd.ms-word.commentsExtensible+xml"><pkg:xmlData><w16cex:commentsExtensible xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex"><w16cex:commentExtensible w16cex:durableId="23456789"/></w16cex:commentsExtensible></pkg:xmlData></pkg:part>',
    ];
    for (const part of parts)
      doc.documentElement.append(
        doc.importNode(
          parse(`<pkg:package xmlns:pkg="${PKG}">${part}</pkg:package>`)
            .documentElement.firstElementChild!,
          true,
        ),
      );
    const source = extractWordStories(doc)[0];
    compileWordStories(
      doc,
      [{ kind: "delete", type: "comment", id: source.id }],
      compile,
      output,
    );
    expect(xml(doc)).not.toContain("12AB34CD");
    expect(xml(doc)).not.toContain("23456789");
    expect(doc.getElementsByTagNameNS(W, "commentReference")).toHaveLength(0);
  });

  it("rejects dangling note references and invalid text offsets before import", () => {
    const { doc, output, compile, first } = setup();
    expect(() =>
      compileWordStories(
        doc,
        [
          {
            kind: "upsert",
            type: "comment",
            id: "c",
            blocks: [block("Review")],
            anchor: { block: "n1", start: 100 },
          },
        ],
        compile,
        output,
      ),
    ).toThrow(/outside/);
    const bad = doc.createElementNS(W, "w:footnoteReference");
    bad.setAttributeNS(W, "w:id", "999");
    first.append(bad);
    expect(() => pruneWordStoryReferences(doc)).toThrow(/has no content/);
  });

  it("passes each story part as owner when compiling nested images or hyperlinks", () => {
    const { doc, output, compile } = setup();
    const owners: string[] = [];
    compileWordStories(
      doc,
      [{ kind: "upsert", type: "footer", id: "f", blocks: [block("Footer")] }],
      (blocks, owner) => {
        owners.push(owner);
        return compile(blocks);
      },
      output,
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
    const { doc, output, compile } = setup();
    compileWordStories(
      doc,
      [{ kind: "upsert", type: "header", id: "h", blocks: [block("Header")] }],
      compile,
      output,
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
            type: "comment",
            id: "c",
            blocks: [block("Text")],
            anchor: { block: "n1", start: 0, end: 3 },
          },
        ],
        parseBlock,
      ),
    ).not.toBeNull();
  });
  it.each([
    [{ kind: "delete", type: "comment", id: "c", blocks: [] }],
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
        type: "comment",
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
