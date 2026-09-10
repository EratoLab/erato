import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttachmentNotice } from "./AttachmentNotice";

describe("AttachmentNotice", () => {
  it("interrupts for an error and waits politely for anything else", () => {
    const { rerender } = render(
      <AttachmentNotice label="Some files were left out" tone="error" />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-ui", "attachment-notice");
    expect(alert).toHaveAttribute("data-tone", "error");
    expect(alert).not.toHaveAttribute("aria-live");

    rerender(<AttachmentNotice label="3 files hidden" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-tone", "neutral");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  // The frame is the live region in the framed form, so its ring must stay
  // decorative or the same wait announces twice; the bare form has no frame to
  // announce anything, so there the ring carries the wait itself.
  it("keeps one announcement per wait in either form", () => {
    const { rerender } = render(
      <AttachmentNotice label="Loading attachments" busy />,
    );

    const framed = screen.getByRole("status");
    expect(framed).toHaveAttribute("aria-busy", "true");
    expect(framed.querySelectorAll('[role="status"]')).toHaveLength(0);
    expect(screen.getByText("Loading attachments")).toBeInTheDocument();

    rerender(<AttachmentNotice label="Loading attachments" busy bare />);
    const bare = document.querySelector('[data-ui="attachment-loading"]');
    expect(bare).toHaveAttribute("aria-busy", "true");
    expect(bare).not.toHaveAttribute("aria-live");
    expect(screen.getByRole("status")).toHaveAttribute("data-ui", "spinner");
    expect(screen.getByText("Loading attachments")).toBeInTheDocument();
  });

  it("takes the chip corner rather than a radius of its own", () => {
    render(<AttachmentNotice label="3 files hidden" description="Show all" />);

    const notice = screen.getByRole("status");
    expect(notice).toHaveClass(
      "attachment-notice-geometry",
      "attachment-notice-skin",
    );
    expect(notice.className).not.toContain("rounded");
    expect(screen.getByText("Show all")).toBeInTheDocument();
  });
});
