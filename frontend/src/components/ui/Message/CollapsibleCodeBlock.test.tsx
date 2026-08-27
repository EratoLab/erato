import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { CollapsibleCodeBlock } from "./CollapsibleCodeBlock";

import type { Messages } from "@lingui/core";

/**
 * jsdom reports every layout box as zero, so overflow has to be simulated.
 * Both properties are patched on the prototype because the component reads
 * them off the clipper element it owns.
 */
function stubHeights({ content, clip }: { content: number; clip: number }) {
  const scroll = vi
    .spyOn(HTMLElement.prototype, "scrollHeight", "get")
    .mockReturnValue(content);
  const client = vi
    .spyOn(HTMLElement.prototype, "clientHeight", "get")
    .mockReturnValue(clip);
  return () => {
    scroll.mockRestore();
    client.mockRestore();
  };
}

async function renderBlock(ui: React.ReactElement) {
  const { i18n } = await import("@lingui/core");
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
  return render(<I18nProvider i18n={i18n}>{ui}</I18nProvider>);
}

const LONG = <div>a long block</div>;

describe("CollapsibleCodeBlock", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("leaves a block that fits alone", async () => {
    const restore = stubHeights({ content: 100, clip: 100 });
    await renderBlock(
      <CollapsibleCodeBlock lineCount={4}>{LONG}</CollapsibleCodeBlock>,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    restore();
  });

  it("offers to reveal the rest of a block that overflows, naming how much", async () => {
    const restore = stubHeights({ content: 900, clip: 384 });
    await renderBlock(
      <CollapsibleCodeBlock lineCount={120}>{LONG}</CollapsibleCodeBlock>,
    );

    const toggle = screen.getByRole("button", { name: /Show all 120 lines/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    restore();
  });

  it("reveals and re-clamps on demand", async () => {
    const restore = stubHeights({ content: 900, clip: 384 });
    await renderBlock(
      <CollapsibleCodeBlock lineCount={120}>{LONG}</CollapsibleCodeBlock>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show all 120 lines/ }));
    const collapse = screen.getByRole("button", { name: /Show less/ });
    expect(collapse).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(collapse);
    expect(
      screen.getByRole("button", { name: /Show all 120 lines/ }),
    ).toHaveAttribute("aria-expanded", "false");
    restore();
  });

  it("paints the surface on the element that clips", async () => {
    // Rounded corners only survive the cut if the same element owns the radius
    // and the clip.
    const restore = stubHeights({ content: 900, clip: 384 });
    const { container } = await renderBlock(
      <CollapsibleCodeBlock
        lineCount={120}
        surfaceStyle={{ borderRadius: "0.3em", background: "#1e1e1e" }}
      >
        {LONG}
      </CollapsibleCodeBlock>,
    );

    const clipper = container.querySelector<HTMLElement>("[style*=max-height]");
    expect(clipper).toHaveClass("overflow-hidden");
    expect(clipper).toHaveStyle({
      borderRadius: "0.3em",
      background: "#1e1e1e",
    });
    restore();
  });

  it("does not clamp while the block is still streaming", async () => {
    // The height changes on every chunk, so a cap would fight the content.
    const restore = stubHeights({ content: 900, clip: 384 });
    await renderBlock(
      <CollapsibleCodeBlock lineCount={120} disabled>
        {LONG}
      </CollapsibleCodeBlock>,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    restore();
  });
});
