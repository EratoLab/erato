import { wordMainBody, WORD_NS } from "./wordNativeContent";

/** Word may insert a space for an empty file. Remove only this placeholder, preserving user whitespace. */
export async function finishWordEmptyDocumentImport(
  context: Word.RequestContext,
  expectedOoxml: string,
): Promise<void> {
  const doc = new DOMParser().parseFromString(expectedOoxml, "application/xml");
  const body = wordMainBody(doc);
  const blocks = Array.from(body?.children ?? []).filter(
    (e) => !(e.namespaceURI === WORD_NS && e.localName === "sectPr"),
  );
  if (
    blocks.length !== 1 ||
    blocks[0].namespaceURI !== WORD_NS ||
    blocks[0].localName !== "p"
  )
    return;
  for (const node of Array.from(blocks[0].children)) {
    if (node.namespaceURI !== WORD_NS) return;
    if (node.localName === "pPr") continue;
    if (node.localName !== "r") return;
    for (const child of Array.from(node.children))
      if (
        child.namespaceURI !== WORD_NS ||
        !(
          child.localName === "rPr" ||
          (child.localName === "t" && child.textContent === "")
        )
      )
        return;
  }
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load("items/text");
  await context.sync();
  if (paragraphs.items.length === 1 && paragraphs.items[0].text === " ") {
    paragraphs.items[0].getRange("Content").insertText("", "Replace");
    await context.sync();
  }
}
