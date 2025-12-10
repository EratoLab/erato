import { t, msg } from "@lingui/core/macro";
import { createPortal } from "react-dom";

import { Button } from "../Controls/Button";
import { ModalBase } from "../Modal/ModalBase";

import type { UiImagePart } from "@/utils/adapters/contentPartAdapter";

interface ImageLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  image: UiImagePart | null;
}

export const ImageLightbox = ({
  isOpen,
  onClose,
  image,
}: ImageLightboxProps) => {
  if (!image || !isOpen) return null;

  const handleDownload = () => {
    if (image.src.startsWith("data:")) {
      // Handle base64 download - open in new tab/trigger download
      const link = document.createElement("a");
      link.href = image.src;
      // eslint-disable-next-line lingui/no-unlocalized-strings
      link.download = `image-${image.id}.png`;
      link.target = "_blank"; // eslint-disable-line lingui/no-unlocalized-strings
      link.rel = "noopener noreferrer";
      link.click();
    } else {
      // Handle URL download - open in new tab
      window.open(image.src, "_blank", "noopener,noreferrer"); // eslint-disable-line lingui/no-unlocalized-strings
    }
  };

  return createPortal(
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title={t(msg({ id: "ui.imagePreview.title", message: "Image Preview" }))}
      contentClassName="max-w-6xl"
    >
      <div className="flex flex-col gap-4">
        <img
          src={image.src}
          alt={t(
            msg({
              id: "ui.imagePreview.altText",
              message: "Preview at full size",
            }),
          )}
          className="max-h-[70vh] w-full object-contain"
        />
        <div className="flex justify-end gap-2">
          <Button onClick={handleDownload} variant="secondary">
            {t(msg({ id: "ui.download", message: "Download" }))}
          </Button>
          <Button onClick={onClose} variant="primary">
            {t(msg({ id: "cloudFilePicker.close", message: "Close" }))}
          </Button>
        </div>
      </div>
    </ModalBase>,
    document.body,
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
ImageLightbox.displayName = "ImageLightbox";
