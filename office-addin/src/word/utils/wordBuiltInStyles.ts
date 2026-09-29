// Localized Word changes style IDs (e.g. "berschrift2") but keeps the canonical
// English w:name of built-in styles, so both are checked.
export const isBuiltInHeadingStyle = (
  styleId: string,
  name: string,
  level: number,
) =>
  styleId.toLowerCase() === `heading${level}` ||
  name.toLowerCase() === `heading ${level}`;

export const isDefaultTableStyle = (styleId: string, name: string) =>
  styleId.toLowerCase() === "tablenormal" ||
  name.toLowerCase() === "normal table";
