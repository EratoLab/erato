import type {
  ContentPart,
  ContentPartText,
  ContentPartImage,
  ContentPartImageFilePointer,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Represents a UI-friendly image content part
 */
export interface UiImagePart {
  type: "image";
  // Either base64 data or download URL
  src: string;
  // ID for React keys
  id: string;
  // Original file_upload_id if from pointer
  fileUploadId?: string;
}

/**
 * Represents a UI-friendly text content part
 */
export interface UiTextPart {
  type: "text";
  text: string;
}

/**
 * Union of all UI content parts
 */
export type UiContentPart = UiTextPart | UiImagePart;

/**
 * Extract text from ContentPart array (backward compat helper)
 */
export function extractTextFromContent(content?: ContentPart[] | null): string {
  if (!content || !Array.isArray(content)) return "";

  return content
    .filter((part) => part.content_type === "text")
    .map((part) => (part as ContentPartText).text)
    .join("");
}

/**
 * Extract images from ContentPart array
 */
export function extractImagesFromContent(
  content?: ContentPart[] | null,
): UiImagePart[] {
  if (!content || !Array.isArray(content)) return [];

  return content
    .filter(
      (part) =>
        part.content_type === "image" ||
        part.content_type === "image_file_pointer",
    )
    .map((part, index) => {
      if (part.content_type === "image") {
        const imagePart = part as ContentPartImage & { content_type: "image" };
        return {
          type: "image" as const,
          src: `data:image/png;base64,${imagePart.base64_data}`,
          id: `image-base64-${index}`,
        };
      } else {
        const pointerPart = part as ContentPartImageFilePointer & {
          content_type: "image_file_pointer";
        };
        return {
          type: "image" as const,
          src: pointerPart.download_url,
          id: pointerPart.file_upload_id,
          fileUploadId: pointerPart.file_upload_id,
        };
      }
    });
}

/**
 * Convert ContentPart array to UI-friendly mixed content
 * Preserves ordering of text and images
 */
export function convertToUiContent(
  content?: ContentPart[] | null,
): UiContentPart[] {
  if (!content || !Array.isArray(content)) return [];

  return content
    .filter(
      (part) =>
        part.content_type === "text" ||
        part.content_type === "image" ||
        part.content_type === "image_file_pointer",
    )
    .map((part, index) => {
      if (part.content_type === "text") {
        const textPart = part as ContentPartText & { content_type: "text" };
        return {
          type: "text" as const,
          text: textPart.text,
        };
      }
      // Handle images
      const images = extractImagesFromContent([part]);
      return images[0]; // Will always return one image
    });
}

/**
 * Check if content contains any images
 */
export function hasImages(content?: ContentPart[] | null): boolean {
  if (!content || !Array.isArray(content)) return false;
  return content.some(
    (part) =>
      part.content_type === "image" ||
      part.content_type === "image_file_pointer",
  );
}

/**
 * Efficiently parse content into text and images in a single pass
 * Avoids double iteration compared to calling extractTextFromContent and extractImagesFromContent separately
 * @param content - Array of ContentPart objects
 * @returns Object containing extracted text and images
 */
export function parseContent(content?: ContentPart[] | null): {
  text: string;
  images: UiImagePart[];
} {
  if (!content || !Array.isArray(content)) {
    return { text: "", images: [] };
  }

  const textParts: string[] = [];
  const images: UiImagePart[] = [];
  let imageIndex = 0;

  content.forEach((part) => {
    if (part.content_type === "text") {
      const textPart = part as ContentPartText & { content_type: "text" };
      textParts.push(textPart.text);
    } else if (part.content_type === "image") {
      const imagePart = part as ContentPartImage & { content_type: "image" };
      images.push({
        type: "image" as const,
        src: `data:image/png;base64,${imagePart.base64_data}`,
        id: `image-base64-${imageIndex}`,
      });
      imageIndex++;
    } else if (part.content_type === "image_file_pointer") {
      const pointerPart = part as ContentPartImageFilePointer & {
        content_type: "image_file_pointer";
      };
      images.push({
        type: "image" as const,
        src: pointerPart.download_url,
        id: pointerPart.file_upload_id,
        fileUploadId: pointerPart.file_upload_id,
      });
      imageIndex++;
    }
  });

  return {
    text: textParts.join(""),
    images,
  };
}
