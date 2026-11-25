import { describe, expect, it } from "vitest";

import { sortMcpServersByName } from "./mcpServerOrder";

const server = (id: string, display_name: string) => ({ id, display_name });

describe("sortMcpServersByName", () => {
  it("orders by the shown name, ignoring case, not by the raw id", () => {
    const sorted = sortMcpServersByName([
      server("Granola", "Granola"),
      server("business_central", "Business Central"),
      server("notion", "notion"),
      server("teams", "Microsoft Teams"),
    ]);

    expect(sorted.map((entry) => entry.display_name)).toEqual([
      "Business Central",
      "Granola",
      "Microsoft Teams",
      "notion",
    ]);
  });

  it("breaks a tie between equal names by id and leaves the input untouched", () => {
    const input = [server("kertos-2", "Kertos"), server("kertos", "Kertos")];

    expect(sortMcpServersByName(input).map((entry) => entry.id)).toEqual([
      "kertos",
      "kertos-2",
    ]);
    expect(input.map((entry) => entry.id)).toEqual(["kertos-2", "kertos"]);
  });
});
