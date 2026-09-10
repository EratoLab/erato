import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { messages as enMessages } from "@/locales/en/messages.json";
import { FILE_TYPES } from "@/utils/fileTypes";

import { AttachmentTile } from "./AttachmentTile";

import type { LocalFilePreviewItem } from "./FilePreviewBase";
import type { Messages } from "@lingui/core";

async function renderWithProviders(ui: React.ReactElement) {
  const { i18n } = await import("@lingui/core");
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");

  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider
        enableCustomTheme={false}
        initialThemeMode="light"
        persistThemeMode={false}
      >
        {ui}
      </ThemeProvider>
    </I18nProvider>,
  );
}

const file = (filename: string): LocalFilePreviewItem => ({
  id: "1",
  filename,
});

// jsdom loads no stylesheet, so a corner is only visible here as the class
// that carries it, and a tint only as the variable handed to it. What these
// assert is the reachable half: every hook a theme keys on is emitted, no chip
// corner is a Tailwind utility again, and the per-type colour still reaches the
// channel that replaced the inline style. Whether the rule on the other end
// paints it is a computed-style question, and the `AllFileTypes` story is where
// that is measured.
describe("AttachmentTile theme hooks", () => {
  it("marks a document face and its icon plate", async () => {
    await renderWithProviders(<AttachmentTile file={file("notes.txt")} />);

    const face = document.querySelector('[data-ui="attachment-tile"]');
    expect(face).toHaveAttribute("data-variant", "tile");
    expect(face).toHaveAttribute("data-media", "document");
    expect(face).toHaveClass("attachment-tile-geometry");

    const plate = document.querySelector('[data-ui="attachment-tile-icon"]');
    expect(plate).toHaveClass(
      "attachment-tile-icon-geometry",
      "attachment-tile-icon-skin",
    );
    // The tint rides the wrapper, not the plate: an inline declaration on the
    // plate would outrank the theme rule its own hook exists to accept.
    expect(plate).not.toHaveAttribute("style");
    expect(
      document
        .querySelector<HTMLElement>("[data-filetype]")
        ?.style.getPropertyValue("--attachment-tile-icon-tint"),
    ).toBe(FILE_TYPES.text.iconColor);
  });

  // The variable has to stay per-type, not a family-wide constant: it is the
  // only thing left carrying the colour, and a plate whose fill never varies
  // still satisfies every class assertion above.
  it("hands each file type its own tint", async () => {
    await renderWithProviders(
      <>
        <AttachmentTile file={file("invoice.pdf")} />
        <AttachmentTile file={file("revenue.csv")} />
      </>,
    );

    const tints = Array.from(
      document.querySelectorAll<HTMLElement>("[data-filetype]"),
    ).map((wrapper) => [
      wrapper.dataset.filetype,
      wrapper.style.getPropertyValue("--attachment-tile-icon-tint"),
    ]);

    expect(tints).toEqual([
      ["pdf", FILE_TYPES.pdf.iconColor],
      ["spreadsheet", FILE_TYPES.spreadsheet.iconColor],
    ]);
  });

  it("marks a media face as its own shape", async () => {
    await renderWithProviders(
      <AttachmentTile file={file("shot.png")} previewUrl="blob:shot" />,
    );

    const face = screen.getByRole("img", { name: "shot.png" });
    expect(face).toHaveAttribute("data-ui", "attachment-tile");
    expect(face).toHaveAttribute("data-media", "image");
    expect(face).toHaveClass("attachment-tile-geometry");
  });

  it("hooks the remove badge without renaming it", async () => {
    await renderWithProviders(
      <AttachmentTile file={file("notes.txt")} onRemove={vi.fn()} />,
    );

    const remove = screen.getByRole("button", { name: "Remove notes.txt" });
    expect(remove).toHaveAttribute("data-ui", "attachment-remove");
    expect(remove).toHaveClass("attachment-badge-geometry");
    expect(remove.className).not.toContain("rounded");
  });
});
