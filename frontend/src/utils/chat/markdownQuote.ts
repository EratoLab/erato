/**
 * Marked text as a markdown quote: `> ` in front of every line, and a break
 * between paragraphs as a line holding only `>`, so the quote stays one block.
 * Code keeps its line breaks inside a fence.
 */
export function formatMarkdownQuote(
  text: string,
  options: { code?: boolean; codeLanguage?: string } = {},
): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const body = options.code
    ? ["```" + (options.codeLanguage ?? ""), ...trimBlankEdges(lines), "```"]
    : collapseBlankRuns(trimBlankEdges(lines.map((line) => line.trimEnd())));
  return body.map((line) => (line === "" ? ">" : `> ${line}`)).join("\n");
}

/**
 * The draft with `block` added as its own paragraph: an empty line before it
 * when the draft holds text, and an empty line after it for the caret, because
 * a line typed directly under a markdown quote would continue the quote.
 */
export function appendBlockToDraft(draft: string, block: string): string {
  const existing = draft.trimEnd();
  return `${existing === "" ? "" : `${existing}\n\n`}${block}\n\n`;
}

function trimBlankEdges(lines: string[]): string[] {
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first === -1) {
    return [];
  }
  const last = lines.findLastIndex((line) => line.trim() !== "");
  return lines.slice(first, last + 1);
}

function collapseBlankRuns(lines: string[]): string[] {
  return lines.filter((line, index) => line !== "" || lines[index - 1] !== "");
}
