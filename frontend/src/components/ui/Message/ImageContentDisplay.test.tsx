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
    const { container } = renderWithTheme(<ImageContentDisplay images={images} />);

    const imageContainer = container.firstElementChild?.firstElementChild;
    const image = screen.getByRole("img", { name: "Message attachment" });

    expect(imageContainer).toHaveStyle({
      maxWidth: "var(--theme-layout-chat-image-preview-max-width)",
    });
    expect(image).toHaveStyle({
      maxHeight: "var(--theme-layout-chat-image-preview-max-height)",
    });
  });

  it("keeps the image click interaction intact", () => {
    const onImageClick = vi.fn();

    renderWithTheme(
      <ImageContentDisplay images={images} onImageClick={onImageClick} />,
    );

    const imageButton = screen.getByRole("button");
    fireEvent.click(imageButton);
    fireEvent.keyDown(imageButton, { key: "Enter" });
    fireEvent.keyDown(imageButton, { key: " " });

    expect(onImageClick).toHaveBeenCalledTimes(3);
    expect(onImageClick).toHaveBeenNthCalledWith(1, images[0]);
    expect(onImageClick).toHaveBeenNthCalledWith(2, images[0]);
    expect(onImageClick).toHaveBeenNthCalledWith(3, images[0]);
  });
});
