/** Base64 signed 16-bit little-endian PCM of `values`, as the voice's streams send it. */
export function pcm16(values: ArrayLike<number>): string {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index++)
    view.setInt16(index * 2, values[index], true);
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return globalThis.btoa(raw);
}
