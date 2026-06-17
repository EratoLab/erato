import type { UiChatMessage } from "@erato/frontend/library";

export const kitClassName = (className?: string): string =>
  ["erato-component-kit-example", className].filter(Boolean).join(" ");

export const fileName = (file: { filename?: string; name?: string }): string =>
  file.filename ?? file.name ?? "";

export const contentText = (content: UiChatMessage["content"]): string => {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part && typeof part === "object" && "text" in part) {
        return String(part.text);
      }
      if (part && typeof part === "object" && "content" in part) {
        return String(part.content);
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
};
