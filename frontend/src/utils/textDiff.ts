export interface TextChange {
  kind: "same" | "removed" | "added";
  text: string;
}

/** Exact tokens: spaces, tabs, paragraph breaks and Unicode are never normalized. */
export function textDiff(
  original: string,
  proposed: string,
): TextChange[] | null {
  if (original === proposed) return [{ kind: "same", text: original }];
  // Bound the quadratic comparison so large edits cannot freeze the task pane.
  if (original.length + proposed.length > 80_000) return null;
  const tokenize = (text: string) =>
    text.match(/\r\n|[\r\n\t]| +|[^\s]+|\s/gu) ?? [];
  const a = tokenize(original);
  const b = tokenize(proposed);
  if ((a.length + 1) * (b.length + 1) > 250_000) return null;
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? 1 + lcs[(i + 1) * width + j + 1]
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  const result: TextChange[] = [];
  const push = (kind: TextChange["kind"], text: string) => {
    const last = result.at(-1);
    if (last?.kind === kind) last.text += text;
    else result.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push("same", a[i++]);
      j++;
    } else if (
      i < a.length &&
      (j === b.length || lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])
    ) {
      push("removed", a[i++]);
    } else {
      push("added", b[j++]);
    }
  }
  return result;
}
