/**
 * Returns true when the given hex color is perceptually dark.
 *
 * Accepts `#RGB` or `#RRGGBB`. Uses HSP perceived brightness with a 0.5
 * threshold: sqrt(0.299·R² + 0.587·G² + 0.114·B²) / 255.
 *
 * Used to infer Outlook theme mode, where `Office.context.officeTheme.isDarkTheme`
 * is not populated and callers must derive mode from `bodyBackgroundColor`.
 */
export function isHexDark(hex: string): boolean {
  const cleaned = hex.replace(/^#/, "");
  const expanded =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;

  if (!/^[0-9a-f]{6}$/i.test(expanded)) {
    return false;
  }

  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);

  const brightness =
    Math.sqrt(0.299 * r * r + 0.587 * g * g + 0.114 * b * b) / 255;
  return brightness < 0.5;
}
