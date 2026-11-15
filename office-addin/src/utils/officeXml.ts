/** XML and part-name helpers shared by the Word and PowerPoint package readers. */

export function officePartPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 512 &&
    !/[\\\s\u0000-\u001f?#]/.test(path) &&
    !path.split("/").some((part) => !part || part === "." || part === "..")
  );
}

export function parseOfficeXml(text: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("XML declarations with entities are not supported.");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (!doc.documentElement || doc.getElementsByTagName("parsererror").length)
    throw new Error("The proposed XML is incomplete or malformed.");
  return doc;
}

export function officeXmlText(bytes: Uint8Array): string {
  const utf16 =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  return new TextDecoder(utf16, { fatal: true }).decode(bytes);
}

export function officeRelationshipTarget(
  owner: string,
  target: string,
): string {
  const result = target.startsWith("/") ? [] : owner.split("/").slice(0, -1);
  for (const segment of target.replace(/^\//, "").split("/")) {
    if (segment === "..") {
      if (!result.length) throw new Error("A relationship leaves the package.");
      result.pop();
    } else if (segment && segment !== ".") result.push(segment);
  }
  return result.join("/");
}
