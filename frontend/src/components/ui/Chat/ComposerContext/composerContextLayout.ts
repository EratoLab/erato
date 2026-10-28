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

export interface StagedAreaGeometry {
  /** The shared cap minus the area's vertical padding. */
  inner: number;
  /** The area's row gap, between the lane and the files. */
  gap: number;
  /** The files slot's height; 0 without files. */
  filesHeight: number;
  /** The first file tile's height; null for a kit slot without tiles. */
  firstTileHeight: number | null;
  /** The pinned "Remove all" row's height; 0 when it is not drawn. */
  pinnedHeight: number;
}

/**
 * The height the chips may take before "+N more". Chips come first, as in the
 * prototype, where files fold away before any chip does; the files keep
 * their pinned "Remove all" row and the top half of their first tile, so the
 * user still sees them. A kit's slot has no tile to halve and counts whole.
 */
export const chipBudgetInStagedArea = ({
  inner,
  gap,
  filesHeight,
  firstTileHeight,
  pinnedHeight,
}: StagedAreaGeometry): number => {
  if (filesHeight <= 0) {
    return Math.max(0, Math.round(inner));
  }
  const peek = firstTileHeight === null ? filesHeight : firstTileHeight / 2;
  const pinned = pinnedHeight > 0 ? pinnedHeight + gap : 0;
  const reserve = Math.min(filesHeight, peek + pinned) + gap;
  return Math.max(0, Math.round(inner - reserve));
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
