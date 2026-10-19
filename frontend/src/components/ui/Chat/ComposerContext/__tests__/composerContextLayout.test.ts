import { describe, expect, it } from "vitest";

import { fitChipsInBudget } from "../composerContextLayout";

import type { LaneBox, LaneGeometry } from "../composerContextLayout";

const ROW = 32;
const GAP = 6;

/** One chip per row, full lane width, like long labels in a 292px lane. */
const stacked = (count: number, width = 292): LaneBox[] =>
  Array.from({ length: count }, (_, index) => ({
    left: 0,
    top: index * (ROW + GAP),
    width,
    height: ROW,
  }));

const geometry = (boxes: LaneBox[], over: Partial<LaneGeometry> = {}) => ({
  boxes,
  moreWidth: 70,
  moreHeight: ROW,
  laneWidth: 292,
  rowGap: GAP,
  colGap: GAP,
  ...over,
});

describe("fitChipsInBudget", () => {
  it("keeps every chip when the last one ends inside the budget", () => {
    expect(fitChipsInBudget(geometry(stacked(3)), 108)).toBe(3);
  });

  it("puts +N more on the last visible row when it fits beside it", () => {
    // Two narrow chips per row: row 1 holds chips 0-1, row 2 chips 2-3.
    const boxes: LaneBox[] = [
      { left: 0, top: 0, width: 100, height: ROW },
      { left: 106, top: 0, width: 100, height: ROW },
      { left: 0, top: 38, width: 100, height: ROW },
      { left: 106, top: 38, width: 100, height: ROW },
      { left: 0, top: 76, width: 100, height: ROW },
    ];
    // Budget of two rows: "+N" (70px) fits after chip 3 (206+6+70 <= 292).
    expect(fitChipsInBudget(geometry(boxes), 70)).toBe(4);
    // A wider "+N" (90px) does not, so chip 3 hides and "+N" takes its place.
    expect(fitChipsInBudget(geometry(boxes, { moreWidth: 90 }), 70)).toBe(3);
  });

  it("drops one more chip when +N more needs a row of its own", () => {
    // Rows are full; chips 0-1 fit in 70px, but "+N" would need a third row.
    expect(fitChipsInBudget(geometry(stacked(5)), 70)).toBe(1);
    expect(fitChipsInBudget(geometry(stacked(5)), 108)).toBe(2);
  });

  it("never folds below one chip", () => {
    expect(fitChipsInBudget(geometry(stacked(4)), 10)).toBe(1);
  });

  it("leaves room the caller reserved for files", () => {
    const cap = 188;
    const filesReserve = 54 + 8;
    expect(fitChipsInBudget(geometry(stacked(6)), cap)).toBe(4);
    expect(fitChipsInBudget(geometry(stacked(6)), cap - filesReserve)).toBe(2);
  });

  it("hides nothing when the boxes have no size (jsdom, detached)", () => {
    const boxes = stacked(5).map((box) => ({ ...box, top: 0, height: 0 }));
    expect(fitChipsInBudget(geometry(boxes), 10)).toBe(5);
    expect(fitChipsInBudget(geometry(stacked(5), { laneWidth: 0 }), 10)).toBe(
      5,
    );
  });
});
