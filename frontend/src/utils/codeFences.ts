/**
 * A fenced block: an opening run of at least three backticks or tildes at the
 * start of a line, through the next line that holds nothing but the same run.
 * An unterminated opener matches nothing and stays ordinary text.
 */
const CODE_FENCE_BLOCK =
  /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm;

/**
 * Applies `transform` to everything outside fenced code blocks and passes the
 * fences through unchanged.
 *
 * Inside a fence, whitespace is content: indentation and blank lines carry the
 * meaning of Python, YAML or a diff. The collapsing that prose needs — trimming
 * line-leading whitespace, folding blank runs — silently breaks such a block
 * while the fence around it still makes the result look intact.
 */
export function mapOutsideCodeFences(
  text: string,
  transform: (segment: string) => string,
): string {
  let result = "";
  let index = 0;
  for (const match of text.matchAll(CODE_FENCE_BLOCK)) {
    result += transform(text.slice(index, match.index)) + match[0];
    index = match.index + match[0].length;
  }
  return result + transform(text.slice(index));
}
