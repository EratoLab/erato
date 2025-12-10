import { useState, useCallback } from "react";

import type { UiImagePart } from "@/utils/adapters/contentPartAdapter";

/**
 * Custom hook for managing image lightbox state
 * Follows React 2025 best practices for separating UI state logic from presentation
 */
export function useImageLightbox() {
  const [selectedImage, setSelectedImage] = useState<UiImagePart | null>(null);

  const openLightbox = useCallback((image: UiImagePart) => {
    setSelectedImage(image);
  }, []);

  const closeLightbox = useCallback(() => {
    setSelectedImage(null);
  }, []);

  return {
    selectedImage,
    isOpen: selectedImage !== null,
    openLightbox,
    closeLightbox,
  };
}
