/**
 * Maps `items` through `fn` with at most `limit` calls in flight, returning
 * results in input order regardless of completion order. Fails fast: the
 * first rejection rejects the whole map.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  const workers = Math.min(Math.max(1, Math.floor(limit)), items.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}
