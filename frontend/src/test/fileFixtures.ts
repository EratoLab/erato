/**
 * Builds a File that reports `size` without allocating it.
 *
 * Upload-limit tests need files around a multi-MiB boundary. Backing those with
 * real buffers makes `toHaveBeenCalledWith` deep-equal every byte, which took
 * seconds per assertion and tripped vitest's 5s timeout in CI.
 */
export function makeFileWithSize(
  name: string,
  size: number,
  type = "application/octet-stream",
): File {
  const file = new File([], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}
