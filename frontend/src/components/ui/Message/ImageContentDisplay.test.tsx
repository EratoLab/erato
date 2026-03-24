import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";

import { ImageContentDisplay } from "./ImageContentDisplay";

import type { UiImagePart } from "@/utils/adapters/contentPartAdapter";
import type React from "react";

const renderWithTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider>{ui}</ThemeProvider>);

const images: UiImagePart[] = [
  {
    id: "image-1",
    type: "image",
    src: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='640' height='480'><rect width='100%' height='100%' fill='%23d1d5db'/></svg>",
  },
];

describe("ImageContentDisplay", () => {
  it("uses theme-backed sizing hooks for chat image previews", () => {
    const { container } = renderWithTheme(
      <ImageContentDisplay images={images} />,
    );

    const imageContainer = container.firstElementChild?.firstElementChild;
    const image = screen.getByRole("img", { name: "Message attachment" });

    expect(imageContainer).toHaveStyle({
      maxWidth: "var(--theme-layout-chat-image-preview-max-width)",
    });
    expect(image).toHaveStyle({
      maxHeight: "var(--theme-layout-chat-image-preview-max-height)",
    });
  });

  it("renders interactive previews as semantic buttons and forwards clicks", () => {
    const onImageClick = vi.fn();

    renderWithTheme(
      <ImageContentDisplay images={images} onImageClick={onImageClick} />,
    );

    const imageButton = screen.getByRole("button");
    fireEvent.click(imageButton);

    expect(imageButton.tagName).toBe("BUTTON");
    expect(onImageClick).toHaveBeenCalledTimes(1);
    expect(onImageClick).toHaveBeenNthCalledWith(1, images[0]);
  });

  it("keeps static previews non-interactive", () => {
    renderWithTheme(<ImageContentDisplay images={images} />);

    const image = screen.getByRole("img", { name: "Message attachment" });

    expect(screen.queryByRole("button")).toBeNull();
    expect(image).not.toHaveClass("cursor-pointer");
    expect(image).not.toHaveClass("hover:scale-105");
  });

  it("uses the same theme height hook for the error fallback", () => {
    renderWithTheme(<ImageContentDisplay images={images} />);

    fireEvent.error(screen.getByRole("img", { name: "Message attachment" }));

    const fallback = screen.getByText("Failed to load image").parentElement;

    expect(fallback).toHaveStyle({
      height: "var(--theme-layout-chat-image-preview-max-height)",
    });
  });
});
