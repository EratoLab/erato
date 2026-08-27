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

    // The frame now also carries a growth toggle, so target the image itself.
    const imageButton = screen.getByRole("button", {
      name: "Message attachment",
    });
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

  it("offers in-place growth on an interactive preview, and re-collapses", () => {
    renderWithTheme(
      <ImageContentDisplay images={images} onImageClick={vi.fn()} />,
    );

    const toggle = screen.getByRole("button", { name: /Expand/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    const collapse = screen.getByRole("button", { name: /Collapse/ });
    expect(collapse).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(collapse);
    expect(screen.getByRole("button", { name: /Expand/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("does not open the full preview when growing in place", () => {
    const onImageClick = vi.fn();
    renderWithTheme(
      <ImageContentDisplay images={images} onImageClick={onImageClick} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Expand/ }));

    expect(onImageClick).not.toHaveBeenCalled();
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
