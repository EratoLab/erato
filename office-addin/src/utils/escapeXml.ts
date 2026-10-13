const XML_ENTITIES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
} as const;

/** Escape the five XML-significant characters for safe interpolation into
 * attribute values and element text. */
export function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => XML_ENTITIES[char as keyof typeof XML_ENTITIES],
  );
}
