import { t, msg } from "@lingui/core/macro";
import { useState, memo } from "react";

import { InteractiveContainer } from "@/components/ui/Container/InteractiveContainer";

import type { UiImagePart } from "@/utils/adapters/contentPartAdapter";

interface ImageContentDisplayProps {
  images: UiImagePart[];
  onImageClick?: (image: UiImagePart) => void;
  className?: string;
}

const IMAGE_PREVIEW_CONTAINER_STYLE = {
  maxWidth: "var(--theme-layout-chat-image-preview-max-width)",
} as const;

const IMAGE_PREVIEW_STYLE = {
  maxHeight: "var(--theme-layout-chat-image-preview-max-height)",
} as const;
const IMAGE_PREVIEW_ERROR_FALLBACK_STYLE = {
  height: "var(--theme-layout-chat-image-preview-max-height)",
} as const;

const IMAGE_PREVIEW_FRAME_CLASS_NAME =
  "relative overflow-hidden rounded-lg border [border-color:var(--theme-border-media)]";
const INTERACTIVE_IMAGE_CLASS_NAME =
  "w-full cursor-pointer object-contain transition-transform hover:scale-105";
const STATIC_IMAGE_CLASS_NAME = "w-full object-contain";

/**
 * Displays images within message content
 * Supports both base64 and URL-based images
 */
export const ImageContentDisplay = memo<ImageContentDisplayProps>(
  ({ images, onImageClick, className = "" }) => {
    const [loadErrors, setLoadErrors] = useState<Set<string>>(new Set());

    if (images.length === 0) return null;

    const handleImageError = (
      imageId: string,
      error: React.SyntheticEvent<HTMLImageElement>,
    ) => {
      // Log error for debugging and analytics
      console.error(`Failed to load image ${imageId}`, {
        src: (error.target as HTMLImageElement).src,
        error: error.type,
      });

      setLoadErrors((prev) => new Set(prev).add(imageId));
    };

    return (
      <div className={`my-4 flex flex-wrap gap-2 ${className}`}>
        {images.map((image) => {
          const hasError = loadErrors.has(image.id);
          const imageElement = hasError ? (
            <div
              className="flex w-full items-center justify-center bg-theme-bg-tertiary p-4 text-center"
              style={IMAGE_PREVIEW_ERROR_FALLBACK_STYLE}
            >
              <span className="text-sm text-theme-fg-muted">
                {t(
                  msg({
                    id: "ui.image.loadError",
                    message: "Failed to load image",
                  }),
                )}
              </span>
            </div>
          ) : (
            <img
              src={image.src}
              alt={t(
                msg({
                  id: "ui.image.messageAttachment",
                  message: "Message attachment",
                }),
              )}
              className={
                onImageClick
                  ? INTERACTIVE_IMAGE_CLASS_NAME
                  : STATIC_IMAGE_CLASS_NAME
              }
              style={IMAGE_PREVIEW_STYLE}
              onError={(e) => handleImageError(image.id, e)}
              loading="lazy"
            />
          );

          if (!onImageClick) {
            return (
              <div
                key={image.id}
                className={IMAGE_PREVIEW_FRAME_CLASS_NAME}
                style={IMAGE_PREVIEW_CONTAINER_STYLE}
              >
                {imageElement}
              </div>
            );
          }

          return (
            <InteractiveContainer
              key={image.id}
              onClick={() => onImageClick(image)}
              fullWidth={false}
              className={IMAGE_PREVIEW_FRAME_CLASS_NAME}
              style={IMAGE_PREVIEW_CONTAINER_STYLE}
            >
              {imageElement}
            </InteractiveContainer>
          );
        })}
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
ImageContentDisplay.displayName = "ImageContentDisplay";
