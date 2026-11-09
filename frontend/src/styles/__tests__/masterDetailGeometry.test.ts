import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MASTER_DETAIL_OVERLAY_QUERY } from "@/components/ui/Container/MasterDetailLayout";

const globalsCss = readFileSync(
  join(process.cwd(), "src/styles/globals.css"),
  "utf8",
)
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\s+/g, " ");

describe("master-detail geometry", () => {
  it("overlays the detail at the breakpoint script is told about", () => {
    expect(globalsCss).toContain(
      `@media ${MASTER_DETAIL_OVERLAY_QUERY} { .master-detail-geometry[data-detail-open] {`,
    );
  });

  it("uses the configured width in the overlay too", () => {
    expect(globalsCss).toContain(
      "width: min(100%, var(--master-detail-width, 24rem));",
    );
  });
});
