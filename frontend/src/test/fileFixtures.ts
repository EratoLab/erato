/**
 * A File that reports `size` without allocating it: real multi-MiB buffers make
 * `toHaveBeenCalledWith` deep-equal every byte and time out in CI.
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
