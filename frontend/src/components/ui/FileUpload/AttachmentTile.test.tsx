import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen } from "@testing-library/react";
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

// jsdom loads no stylesheet, so these assert the reachable half: every hook is
// emitted, no chip corner is a Tailwind utility, and the per-type colour reaches
// the channel that replaced the inline style. The browser harness measures the rest.
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
    // The tint rides the wrapper so a theme rule on the plate still wins.
    expect(plate).not.toHaveAttribute("style");
    expect(
      document
        .querySelector<HTMLElement>("[data-filetype]")
        ?.style.getPropertyValue("--attachment-tile-icon-tint"),
    ).toBe(FILE_TYPES.text.iconColor);
  });

  // A plate whose fill never varies still passes every class assertion above.
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

const noop = () => {};

describe("AttachmentTile shapes", () => {
  // One chip, one hook: a nested second emitter would double every
  // `querySelectorAll` a theme rule or a test makes.
  it.each([["tile"], ["row"], ["bare"]] as const)(
    "emits the chip hook exactly once as a %s",
    async (variant) => {
      await renderWithProviders(
        <AttachmentTile
          file={file("notes.txt")}
          variant={variant}
          previewUrl="blob:notes"
        />,
      );

      const tiles = document.querySelectorAll('[data-ui="attachment-tile"]');
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toHaveAttribute("data-variant", variant);
    },
  );

  it("draws a caller's own remove control inside the chip, not as a badge", async () => {
    await renderWithProviders(
      <AttachmentTile
        file={file("notes.txt")}
        onRemove={noop}
        removeControl={
          <button type="button" disabled>
            Detach
          </button>
        }
      />,
    );

    // The badge hides until hover, so a caller's control has to sit in the row.
    expect(document.querySelector('[data-ui="attachment-remove"]')).toBeNull();
    const face = document.querySelector('[data-ui="attachment-tile"]');
    expect(face).toContainElement(
      screen.getByRole("button", { name: "Detach" }),
    );
  });

  it("reports selection and validation as presence attributes", async () => {
    await renderWithProviders(
      <>
        <AttachmentTile
          file={file("invoice.pdf")}
          variant="row"
          selection={{ selected: true, onToggle: noop }}
          validation={{ ok: false, reason: "Too large" }}
        />
        <AttachmentTile
          file={file("notes.txt")}
          variant="row"
          selection={{ selected: false, onToggle: noop }}
          validation={{ ok: true }}
        />
      </>,
    );

    const [invalid, valid] = Array.from(
      document.querySelectorAll('[data-ui="attachment-tile"]'),
    );
    expect(invalid).toHaveAttribute("data-selected", "true");
    expect(invalid).toHaveAttribute("data-invalid", "true");
    expect(screen.getByText("Too large")).toBeInTheDocument();
    expect(valid).not.toHaveAttribute("data-selected");
    expect(valid).not.toHaveAttribute("data-invalid");
  });

  it("makes a selectable chip one label when nothing else can be activated", async () => {
    const onToggle = vi.fn();
    await renderWithProviders(
      <AttachmentTile
        file={file("invoice.pdf")}
        variant="row"
        selection={{ selected: true, onToggle }}
      />,
    );

    const frame = document.querySelector('[data-ui="attachment-tile"]');
    expect(frame?.tagName).toBe("LABEL");
    expect(frame).toContainElement(screen.getByRole("checkbox"));
    expect(
      screen.queryByRole("button", { name: /Preview attachment/ }),
    ).toBeNull();
  });

  // Selectable and activatable must not share one `label`.
  it("splits the checkbox from an activatable body", async () => {
    const onToggle = vi.fn();
    const onActivate = vi.fn();
    await renderWithProviders(
      <AttachmentTile
        file={file("invoice.pdf")}
        variant="row"
        selection={{ selected: true, onToggle }}
        onActivate={onActivate}
      />,
    );

    const frame = document.querySelector('[data-ui="attachment-tile"]');
    expect(frame?.tagName).toBe("DIV");

    const body = screen.getByRole("button", {
      name: "Preview attachment invoice.pdf, PDF",
    });
    expect(body).not.toContainElement(screen.getByRole("checkbox"));

    fireEvent.click(body);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe("AttachmentTile filename and type line", () => {
  it("keeps the whole filename in one node while the type line names the extension", async () => {
    await renderWithProviders(<AttachmentTile file={file("revenue.csv")} />);

    expect(screen.getByText("revenue.csv")).toBeInTheDocument();
    expect(screen.getByText("CSV")).toBeInTheDocument();
  });

  // Splitting the name costs a whole-name query, so a line already ending in
  // the extension does without.
  it("pins the extension in its own node under a family type line", async () => {
    await renderWithProviders(
      <AttachmentTile file={file("report.csv")} showType="family" />,
    );

    expect(screen.getByText("report")).toBeInTheDocument();
    expect(screen.getByText(".csv")).toBeInTheDocument();
    expect(screen.getByText("SPREADSHEET")).toBeInTheDocument();
  });

  it("pins the extension in its own node once the type line is gone", async () => {
    await renderWithProviders(
      <AttachmentTile file={file("invoice.pdf")} showType="none" />,
    );

    expect(screen.getByText("invoice")).toBeInTheDocument();
    expect(screen.getByText(".pdf")).toBeInTheDocument();
    expect(screen.queryByText("PDF")).toBeNull();
  });

  it("drops the type line from the accessible name with it", async () => {
    await renderWithProviders(
      <AttachmentTile
        file={file("invoice.pdf")}
        showType="none"
        onActivate={noop}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Preview attachment invoice.pdf" }),
    ).toBeInTheDocument();
  });
});
