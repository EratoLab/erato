/**
 * The bytes of `blob` as standard base64. `FileReader.readAsDataURL` streams
 * large payloads through the browser's own encoder instead of blowing the
 * call stack via `btoa(String.fromCharCode(...))`.
 */
export async function encodeBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
  const commaIndex = dataUrl.indexOf(",");
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : "";
}
