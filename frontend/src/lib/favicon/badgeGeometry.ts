export const ICON_CANVAS_SIZE = 32;

export interface BadgeGeometry {
  cx: number;
  cy: number;
  dotRadius: number;
  ringRadius: number;
}

/** Lower-right dot, sized to stay legible once the tab paints the icon at 16px. */
export const badgeGeometry = (
  size: number = ICON_CANVAS_SIZE,
): BadgeGeometry => {
  const ringRadius = size * 0.28;
  return {
    cx: size - ringRadius,
    cy: size - ringRadius,
    dotRadius: ringRadius * 0.72,
    ringRadius,
  };
};
