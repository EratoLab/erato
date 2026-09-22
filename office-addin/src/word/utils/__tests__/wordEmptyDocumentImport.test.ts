import { describe, expect, it, vi } from "vitest";

import { finishWordEmptyDocumentImport } from "../wordEmptyDocumentImport";

const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const xml = (body: string) =>
  `<w:document xmlns:w="${w}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
function host(texts: string[]) {
  const insert = vi.fn();
  const range = vi.fn(() => ({ insertText: insert }));
  const load = vi.fn();
  const sync = vi.fn(async () => {});
  const context = {
    document: {
      body: {
        paragraphs: {
          load,
          items: texts.map((text) => ({ text, getRange: range })),
        },
      },
    },
    sync,
  } as unknown as Word.RequestContext;
  return { context, insert, range, load };
}
describe("native empty document import placeholder", () => {
  it("removes only the importer-added single space from an intended empty paragraph without clearing its formatting", async () => {
    const h = host([" "]);
    await finishWordEmptyDocumentImport(
      h.context,
      xml(
        '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve"/></w:r></w:p>',
      ),
    );
    expect(h.range).toHaveBeenCalledWith("Content");
    expect(h.insert).toHaveBeenCalledExactlyOnceWith("", "Replace");
  });
  it.each([" ", "  ", "\t", "draft"])(
    "never treats intended content %j as an empty document",
    async (text) => {
      const h = host([" "]);
      await finishWordEmptyDocumentImport(
        h.context,
        xml(`<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`),
      );
      expect(h.load).not.toHaveBeenCalled();
      expect(h.insert).not.toHaveBeenCalled();
    },
  );
  it.each([[""], ["  "], ["changed"], [" ", ""]])(
    "does not erase unexpected native content %j",
    async (...texts) => {
      const h = host(texts);
      await finishWordEmptyDocumentImport(h.context, xml("<w:p/>"));
      expect(h.insert).not.toHaveBeenCalled();
    },
  );
  it("does not erase an image-only document or a bookmark range", async () => {
    for (const p of [
      "<w:p><w:r><w:drawing/></w:r></w:p>",
      '<w:p><w:bookmarkStart w:id="1" w:name="test"/><w:bookmarkEnd w:id="1"/></w:p>',
    ]) {
      const h = host([" "]);
      await finishWordEmptyDocumentImport(h.context, xml(p));
      expect(h.load).not.toHaveBeenCalled();
    }
  });
});
