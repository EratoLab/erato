/** The bytes of base64 `data`, or none when it is not base64. */
export function decodeBase64(data: string): Uint8Array | undefined {
  try {
    return Uint8Array.from(globalThis.atob(data), (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}
