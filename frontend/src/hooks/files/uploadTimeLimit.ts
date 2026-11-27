/**
 * Time limit for one upload request, to end one on a connection that died
 * silently. Fetch reports no upload progress, so the limit has to allow the
 * slowest line that still moves: five minutes plus the files at 4 KB/s.
 */
export function uploadTimeLimitMs(totalBytes: number): number {
  return 5 * 60_000 + Math.ceil(totalBytes / 4);
}
