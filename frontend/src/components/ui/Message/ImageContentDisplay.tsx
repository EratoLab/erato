import { t, msg } from "@lingui/core/macro";
import { useState, memo } from "react";

import { InteractiveContainer } from "@/components/ui/Container/InteractiveContainer";
import { ExpandMediaButton } from "@/components/ui/Controls/ExpandMediaButton";

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
    // Independent per image: growing one says nothing about the others.
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    const toggleExpanded = (imageId: string) =>
      setExpandedIds((previous) => {
        const next = new Set(previous);
        if (!next.delete(imageId)) {
          next.add(imageId);
        }
        return next;
      });

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
          const expanded = expandedIds.has(image.id);
          const imageLabel = t(
            msg({
              id: "ui.image.messageAttachment",
              message: "Message attachment",
            }),
          );
          // Collapsed sits at the chat image bounds; expanded gives the image
          // the full message width, which is the point — a generated chart at
          // 24rem is often too small to read, and the lightbox is a heavier
          // interaction than the question deserves.
          const frameStyle = expanded
            ? { maxWidth: "100%" }
            : IMAGE_PREVIEW_CONTAINER_STYLE;
          const pictureStyle = expanded ? undefined : IMAGE_PREVIEW_STYLE;
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
              style={pictureStyle}
              onError={(e) => handleImageError(image.id, e)}
              loading="lazy"
            />
          );

          // A static preview stays wholly non-interactive by contract, so it
          // gets no growth affordance either — only the already-clickable
          // variant below offers the middle tier.
          if (!onImageClick) {
            return (
              <div
                key={image.id}
                className={`group ${IMAGE_PREVIEW_FRAME_CLASS_NAME}`}
                style={frameStyle}
              >
                {imageElement}
              </div>
            );
          }

          return (
            <div key={image.id} className="group relative" style={frameStyle}>
              <InteractiveContainer
                onClick={() => onImageClick(image)}
                fullWidth={false}
                className={IMAGE_PREVIEW_FRAME_CLASS_NAME}
              >
                {imageElement}
              </InteractiveContainer>
              {!hasError && (
                <ExpandMediaButton
                  expanded={expanded}
                  onToggle={() => toggleExpanded(image.id)}
                  label={imageLabel}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
ImageContentDisplay.displayName = "ImageContentDisplay";
