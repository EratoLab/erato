export interface LaneBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LaneGeometry {
  /** Every chip, in render order, relative to the lane's top-left corner. */
  boxes: LaneBox[];
  moreWidth: number;
  moreHeight: number;
  laneWidth: number;
  rowGap: number;
  colGap: number;
}

/**
 * How many chips stay visible inside `budget` px of height, leaving room on
 * the last visible row (or one row down) for a "+N more" chip. Chips wrap like
 * flex items, so hiding the tail never moves the chips before it and one
 * measurement of the full list is enough.
 */
export const fitChipsInBudget = (
  { boxes, moreWidth, moreHeight, laneWidth, rowGap, colGap }: LaneGeometry,
  budget: number,
): number => {
  const count = boxes.length;
  const bottomOf = (box: LaneBox) => box.top + box.height;
  // jsdom and a detached lane report zero boxes; nothing can be judged, so
  // nothing is hidden.
  if (count === 0 || laneWidth <= 0 || boxes.every((box) => box.height === 0)) {
    return count;
  }
  if (bottomOf(boxes[count - 1]) <= budget) {
    return count;
  }
  for (let visible = count - 1; visible >= 1; visible--) {
    const last = boxes[visible - 1];
    const rowsFit = boxes
      .slice(0, visible)
      .every((box) => bottomOf(box) <= budget);
    if (!rowsFit) {
      continue;
    }
    const right = last.left + last.width;
    const moreBottom =
      right + colGap + moreWidth <= laneWidth
        ? last.top + Math.max(last.height, moreHeight)
        : bottomOf(last) + rowGap + moreHeight;
    if (moreBottom <= budget) {
      return visible;
    }
  }
  return 1;
};

const px = (value: string) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Reads the measuring pass: every chip plus the "+N more" chip rendered in
 * the lane. Its own module so tests can hand the lane a geometry.
 */
export const readLaneGeometry = (lane: HTMLElement): LaneGeometry | null => {
  const chips = [
    ...lane.querySelectorAll<HTMLElement>(
      // eslint-disable-next-line lingui/no-unlocalized-strings -- a selector
      ':scope > [data-ui="composer-context-chip"]',
    ),
  ];
  const more = lane.querySelector<HTMLElement>(
    // eslint-disable-next-line lingui/no-unlocalized-strings -- a selector
    ':scope > [data-ui="composer-context-more"]',
  );
  if (!more) {
    return null;
  }
  const laneRect = lane.getBoundingClientRect();
  const style = window.getComputedStyle(lane);
  const moreRect = more.getBoundingClientRect();
  return {
    boxes: chips.map((chip) => {
      const rect = chip.getBoundingClientRect();
      return {
        left: rect.left - laneRect.left,
        top: rect.top - laneRect.top,
        width: rect.width,
        height: rect.height,
      };
    }),
    moreWidth: moreRect.width,
    moreHeight: moreRect.height,
    laneWidth: laneRect.width,
    rowGap: px(style.rowGap),
    colGap: px(style.columnGap),
  };
};
