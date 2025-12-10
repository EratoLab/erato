/**
 * File type detection utilities
 * Centralized logic for determining file types and categories
 */

/**
 * Checks if a filename represents an image file based on its extension
 * @param filename - The filename to check
 * @returns true if the file is an image type
 */
export function isImageFile(filename: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(filename);
}

/**
 * Gets the MIME type from a filename based on its extension
 * @param filename - The filename to check
 * @returns The MIME type or null if unknown
 */
export function getMimeTypeFromFilename(filename: string): string | null {
  const extension = filename.toLowerCase().split(".").pop();

  const mimeTypes: Record<string, string> = {
    // Images
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    ico: "image/x-icon",

    // Documents
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",

    // Text
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",

    // Code
    json: "application/json",
    xml: "application/xml",
    html: "text/html",
    css: "text/css",
    js: "application/javascript",
    ts: "application/typescript",
  };

  return extension ? mimeTypes[extension] || null : null;
}

/**
 * Checks if a file is a document type (PDF, Word, Excel, etc.)
 * @param filename - The filename to check
 * @returns true if the file is a document type
 */
export function isDocumentFile(filename: string): boolean {
  return /\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/i.test(filename);
}

/**
 * Checks if a file is a text file
 * @param filename - The filename to check
 * @returns true if the file is a text type
 */
export function isTextFile(filename: string): boolean {
  return /\.(txt|md|csv|json|xml|html|css|js|ts|tsx|jsx)$/i.test(filename);
}
