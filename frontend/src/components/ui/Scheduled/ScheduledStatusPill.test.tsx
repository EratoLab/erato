import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  SCHEDULED_ITEM_STATUSES,
  ScheduledStatusPill,
  scheduledStatusLabel,
  scheduledStatusTone,
} from "./ScheduledStatusPill";

describe("scheduled item status", () => {
  it("gives every status its own fixed tone", () => {
    expect(
      Object.fromEntries(
        SCHEDULED_ITEM_STATUSES.map((status) => [
          status,
          scheduledStatusTone(status),
        ]),
      ),
    ).toEqual({
      scheduled: "info",
      snoozed: "muted",
      done: "success",
      failed: "error",
      cancelled: "muted",
    });
  });

  it("names the statuses without the channel they went out on", () => {
    expect(SCHEDULED_ITEM_STATUSES.map(scheduledStatusLabel)).toEqual([
      "Scheduled",
      "Snoozed",
      "Done",
      "Failed",
      "Cancelled",
    ]);
  });

  it("renders the pill in the status tone", () => {
    render(<ScheduledStatusPill status="failed" />);

    const pill = screen.getByText("Failed");
    expect(pill).toHaveAttribute("data-ui", "status-pill");
    expect(pill).toHaveAttribute("data-tone", "error");
    expect(pill).toHaveClass(
      "pill-geometry",
      "border-theme-error-border",
      "bg-theme-error-bg",
      "text-theme-error-fg",
    );
  });
});
