/** The body text size an iPhone uses at its default text size setting. */
const SYSTEM_BODY_DEFAULT_PX = 17;

/**
 * The largest regular text size (23 pt body). The accessibility sizes reach
 * three times the default, which would scale the whole layout, sidebar and
 * dialogs included, past a phone's width.
 */
const MAX_SCALE = 23 / SYSTEM_BODY_DEFAULT_PX;

/**
 * The device's text size setting as a factor of its default, where the
 * browser engine reports it: WebKit resolves the `-apple-system-body` font to
 * the body size the phone's setting asks for. Elsewhere the keyword is not a
 * valid font and this returns null.
 */
export function systemTextScale(): number | null {
  if (typeof document === "undefined") return null;
  const probe = document.createElement("span");
  // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS font keyword, not user-facing
  probe.style.font = "-apple-system-body";
  if (!probe.style.font) return null;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const px = parseFloat(window.getComputedStyle(probe).fontSize);
  probe.remove();
  return Number.isFinite(px) && px > 0
    ? Math.min(px / SYSTEM_BODY_DEFAULT_PX, MAX_SCALE)
    : null;
}
