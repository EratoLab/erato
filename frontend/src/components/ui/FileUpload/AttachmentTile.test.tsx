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

const noop = () => {};

describe("AttachmentTile shapes", () => {
  // The hook names one chip. While the grouped preview still hand-rolls its own
  // row around this component, a second emitter inside the first would double
  // every `querySelectorAll` a test or a theme rule makes, and index-addressed
  // queries would silently start reading the wrapper.
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

    // The badge is invisible until the chip is hovered, so a control handed in
    // from outside — the kits' disabled one above all — has to sit in the row.
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

  // A label forwards every click inside it to its control, so the two
  // affordances have to stop sharing one: activating the body would otherwise
  // open the preview and deselect the file in the same gesture.
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

  // Pinned beside a stem that truncates, the extension survives a long name —
  // at the price of splitting it across two nodes, which is why the one line
  // that already ends in the extension does without.
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
