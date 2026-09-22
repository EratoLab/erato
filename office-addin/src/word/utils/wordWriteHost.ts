/**
 * The one place `globalThis.Word` is reached for a WRITE.
 *
 * `readWordDocument.ts` has the same shape for the read path; the two are
 * deliberately not shared, because the read must never be able to reach a
 * mutating call by accident.
 */
interface WordGlobal {
  run: <T>(
    callback: (context: Word.RequestContext) => Promise<T>,
  ) => Promise<T>;
}

export function wordWriteHost(): WordGlobal | null {
  const candidate = (globalThis as { Word?: Partial<WordGlobal> }).Word;
  return typeof candidate?.run === "function"
    ? (candidate as WordGlobal)
    : null;
}
