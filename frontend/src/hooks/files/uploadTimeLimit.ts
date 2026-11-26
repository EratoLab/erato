/**
 * Time limit for one upload request. Generous, because fetch reports no
 * progress: two minutes plus the time the files take at 20 KB/s, so a slow
 * but moving upload finishes while one on a connection that died silently
 * ends.
 */
export function uploadTimeLimitMs(totalBytes: number): number {
  return 120_000 + Math.ceil(totalBytes / 20);
}
