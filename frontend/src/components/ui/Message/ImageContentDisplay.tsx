import { t, msg } from "@lingui/core/macro";
import { useState, memo } from "react";

import type { UiImagePart } from "@/utils/adapters/contentPartAdapter";

interface ImageContentDisplayProps {
  images: UiImagePart[];
  onImageClick?: (image: UiImagePart) => void;
  className?: string;
}

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

          return (
            <div
              key={image.id}
              className="relative max-w-sm overflow-hidden rounded-lg border border-theme-border-primary"
              onClick={() => onImageClick?.(image)}
              role={onImageClick ? "button" : undefined}
              tabIndex={onImageClick ? 0 : undefined}
              onKeyDown={(e) => {
                if (onImageClick && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onImageClick(image);
                }
              }}
            >
              {hasError ? (
                <div className="flex h-48 w-full items-center justify-center bg-theme-bg-tertiary p-4 text-center">
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
                  className="max-h-96 w-full cursor-pointer object-contain transition-transform hover:scale-105"
                  onError={(e) => handleImageError(image.id, e)}
                  loading="lazy"
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
