/** Body blocks are numbered in document order: b1, b2, … */
export const wordBodyRef = (index: number) => `b${index + 1}`;

/** The document-order index of a body ref; undefined for any other ref. */
export function wordBodyRefIndex(ref: string): number | undefined {
  const match = /^b([1-9]\d*)$/u.exec(ref);
  return match ? Number(match[1]) - 1 : undefined;
}
