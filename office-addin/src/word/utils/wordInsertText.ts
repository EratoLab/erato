import { wordWriteHost } from "./wordWriteHost";

/** After inserts beyond a selection; Replace would delete the highlighted content. */
export async function insertWordTextAtCursor(text: string): Promise<boolean> {
  const word = wordWriteHost();
  if (!word) return false;
  try {
    return await word.run(async (context) => {
      const selection = context.document.getSelection();
      selection.load("text");
      await context.sync();

      const hasSelection = (selection.text ?? "").length > 0;
      selection.insertText(text, hasSelection ? "After" : "Replace");
      await context.sync();
      return true;
    });
  } catch (error) {
    console.warn("Failed to insert text into the Word document:", error);
    return false;
  }
}
