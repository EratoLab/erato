import { describe, expect, it } from "vitest";

import { packageXml } from "../../../test/mocks/word/authoringFixtures";
import {
  applyWordNativeStructures,
  compileWordBookmark,
  compileWordContentControl,
  compileWordField,
  inventoryWordNativeStructures,
  isWordFieldSpec,
  isWordNativeStructureEdit,
} from "../wordInlineStructures";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const doc = (body = "<w:p/>") =>
  new DOMParser().parseFromString(packageXml(body), "application/xml");
const compile = (document: Document) => (texts: string[]) =>
  texts.map((value) => {
    const p = document.createElementNS(W, "w:p"),
      r = document.createElementNS(W, "w:r"),
      t = document.createElementNS(W, "w:t");
    t.textContent = value;
    r.append(t);
    p.append(r);
    return p;
  });
const visible = (node: Element) =>
  Array.from(node.getElementsByTagNameNS(W, "t"))
    .map((n) => n.textContent)
    .join("");

describe("typed fields, bookmarks and content controls", () => {
  it("creates fields as fields, escapes results and rejects external-resource and command field codes", () => {
    const p = compileWordField(doc(), {
      instruction: "PAGE \\* MERGEFORMAT",
      text: "1 < 2",
    });
    expect(p.getElementsByTagNameNS(W, "instrText")[0].textContent).toBe(
      "PAGE \\* MERGEFORMAT",
    );
    expect(visible(p)).toBe("1 < 2");
    for (const instruction of [
      'INCLUDETEXT "https://example.test"',
      'DDEAUTO "command"',
      "MACROBUTTON RunSomething",
      'LINK Excel.Sheet "file"',
      "PAGE { DDEAUTO bad }",
    ])
      expect(isWordFieldSpec({ instruction, text: "" })).toBe(false);
  });

  it("pairs bookmark boundaries across multiple paragraphs and keeps control content editable", () => {
    const document = doc();
    const blocks = compileWordBookmark(
      document,
      { name: "Report_Overview", children: ["One", "Two"] },
      compile(document),
    );
    expect(
      blocks[0]
        .getElementsByTagNameNS(W, "bookmarkStart")[0]
        .getAttributeNS(W, "id"),
    ).toBe(
      blocks[1]
        .getElementsByTagNameNS(W, "bookmarkEnd")[0]
        .getAttributeNS(W, "id"),
    );
    const control = compileWordContentControl(
      document,
      {
        title: "Summary",
        tag: "summary",
        lock: "none",
        children: ["Editable summary"],
      },
      compile(document),
    );
    expect(control.getElementsByTagNameNS(W, "lock")).toHaveLength(0);
    expect(inventoryWordNativeStructures(control)).toMatchObject([
      {
        kind: "content-control",
        target: "control-1",
        title: "Summary",
        text: "Editable summary",
        lock: "none",
      },
    ]);
  });

  it("updates and unwraps complex fields without deleting surrounding paragraphs or visible results", () => {
    const document = doc(
      '<w:p><w:r><w:t>Before </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t> After</w:t></w:r></w:p>',
    );
    const body = document.getElementsByTagNameNS(W, "body")[0];
    applyWordNativeStructures(
      document,
      body,
      [
        {
          kind: "field",
          target: "field-1",
          operation: "update",
          instruction: "NUMPAGES",
          text: "12",
        },
      ],
      { compileBlocks: compile(document) },
    );
    expect(visible(body)).toBe("Before 12 After");
    expect(inventoryWordNativeStructures(body)).toMatchObject([
      { kind: "field", instruction: " NUMPAGES ", text: "12" },
    ]);
    applyWordNativeStructures(
      document,
      body,
      [{ kind: "field", target: "field-1", operation: "unwrap" }],
      { compileBlocks: compile(document) },
    );
    expect(body.getElementsByTagNameNS(W, "fldChar")).toHaveLength(0);
    expect(body.getElementsByTagNameNS(W, "instrText")).toHaveLength(0);
    expect(visible(body)).toBe("Before 12 After");
  });

  it("updates a bookmark across paragraph boundaries while preserving text outside its range", () => {
    const document = doc(
      '<w:p><w:r><w:t>Outside left </w:t></w:r><w:bookmarkStart w:id="2" w:name="old"/><w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r><w:bookmarkEnd w:id="2"/><w:r><w:t> Outside right</w:t></w:r></w:p>',
    );
    const body = document.getElementsByTagNameNS(W, "body")[0];
    applyWordNativeStructures(
      document,
      body,
      [
        {
          kind: "bookmark",
          target: "bookmark-1",
          operation: "update",
          name: "new_name",
          text: "Rewritten",
        },
      ],
      { compileBlocks: compile(document) },
    );
    expect(visible(body)).toBe("Outside left Rewritten Outside right");
    expect(
      body
        .getElementsByTagNameNS(W, "bookmarkStart")[0]
        .getAttributeNS(W, "name"),
    ).toBe("new_name");
    expect(body.getElementsByTagNameNS(W, "bookmarkEnd")).toHaveLength(1);
  });

  it("rewrites and unlocks existing content controls, removing stale data bindings while retaining unknown metadata", () => {
    const document = doc(
      '<w:sdt><w:sdtPr><w:id w:val="7"/><w:lock w:val="sdtContentLocked"/><w:dataBinding w:xpath="/item"/><x:metadata xmlns:x="urn:test"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Old</w:t></w:r></w:p></w:sdtContent></w:sdt>',
    );
    const body = document.getElementsByTagNameNS(W, "body")[0];
    applyWordNativeStructures(
      document,
      body,
      [
        {
          kind: "content-control",
          target: "control-1",
          operation: "update",
          lock: "none",
          children: ["New", "Second"],
        },
      ],
      { compileBlocks: compile(document) },
    );
    expect(visible(body)).toBe("NewSecond");
    expect(body.getElementsByTagNameNS(W, "lock")).toHaveLength(0);
    expect(body.getElementsByTagNameNS(W, "dataBinding")).toHaveLength(0);
    expect(body.getElementsByTagNameNS("urn:test", "metadata")).toHaveLength(1);
    applyWordNativeStructures(
      document,
      body,
      [{ kind: "content-control", target: "control-1", operation: "unwrap" }],
      { compileBlocks: compile(document) },
    );
    expect(body.getElementsByTagNameNS(W, "sdt")).toHaveLength(0);
    expect(visible(body)).toBe("NewSecond");
  });

  it("resolves targets before deletion and rejects duplicate or malformed target instructions", () => {
    const document = doc(
      '<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple><w:fldSimple w:instr="NUMPAGES"><w:r><w:t>2</w:t></w:r></w:fldSimple></w:p>',
    );
    const body = document.getElementsByTagNameNS(W, "body")[0];
    applyWordNativeStructures(
      document,
      body,
      [
        { kind: "field", target: "field-1", operation: "delete" },
        { kind: "field", target: "field-2", operation: "update", text: "3" },
      ],
      { compileBlocks: compile(document) },
    );
    expect(visible(body)).toBe("3");
    expect(
      isWordNativeStructureEdit(
        { kind: "field", target: "control-1", operation: "delete" },
        () => true,
      ),
    ).toBe(false);
    expect(
      isWordNativeStructureEdit(
        {
          kind: "bookmark",
          target: "bookmark-1",
          operation: "unwrap",
          name: "silent_change",
        },
        () => true,
      ),
    ).toBe(false);
  });
});
