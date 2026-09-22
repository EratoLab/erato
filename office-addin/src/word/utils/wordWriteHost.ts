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
