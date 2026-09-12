import { badgeGeometry, ICON_CANVAS_SIZE } from "./badgeGeometry";

const BASE_ICON_URL = "/favicon.svg";

export type TabIndicatorTone = "working" | "ready" | "attention";

/** Literals, not theme tokens: the favicon is an isolated document with no CSS vars. */
const TONE_FILL: Record<TabIndicatorTone, string> = {
  working: "#8e9ba1",
  ready: "#1f9d55",
  attention: "#b4690e",
};

type BaseIcon =
  | { kind: "svg"; markup: string }
  | { kind: "raster"; dataUri: string };

let baseIconPromise: Promise<BaseIcon | null> | null = null;
const framesByTone = new Map<TabIndicatorTone | null, string>();

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary);
};

const fetchBaseIcon = async (): Promise<BaseIcon | null> => {
  const response = await fetch(BASE_ICON_URL);
  if (!response.ok) {
    return null;
  }
  const contentType = response.headers.get("content-type") ?? "";
  // An auth redirect lands here as a 200 HTML page; embedding it would paint
  // garbage as the icon.
  if (!contentType.startsWith("image/")) {
    return null;
  }
  // The backend resolves themed favicons by precedence and answers this .svg
  // path with a theme's .ico bytes when that is all it ships, so the response
  // header decides the branch and the URL extension cannot.
  if (contentType.includes("svg")) {
    return { kind: "svg", markup: await response.text() };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    kind: "raster",
    dataUri: `data:${contentType};base64,${bytesToBase64(bytes)}`,
  };
};

/**
 * Re-sizes the themed icon into a nested `<svg>`, which keeps its own viewBox
 * and its `prefers-color-scheme` rules live inside the composed data URI.
 */
const nestBaseSvg = (markup: string): string | null => {
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  if (
    parsed.getElementsByTagName("parsererror").length > 0 ||
    parsed.documentElement.nodeName !== "svg"
  ) {
    return null;
  }
  const root = parsed.documentElement;
  root.setAttribute("width", String(ICON_CANVAS_SIZE));
  root.setAttribute("height", String(ICON_CANVAS_SIZE));
  root.removeAttribute("x");
  root.removeAttribute("y");
  return new XMLSerializer().serializeToString(root);
};

const badgeMarkup = (tone: TabIndicatorTone): string => {
  const { cx, cy, dotRadius, ringRadius } = badgeGeometry();
  // The white ring is what separates the dot from a dark tab strip.
  return (
    `<circle cx="${cx}" cy="${cy}" r="${ringRadius}" fill="#ffffff"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${dotRadius}" fill="${TONE_FILL[tone]}"/>`
  );
};

/** `null` tone yields the un-badged frame, which is the blink's "off" state. */
export const composeBadgedIcon = async (
  tone: TabIndicatorTone | null,
): Promise<string | null> => {
  const cached = framesByTone.get(tone);
  if (cached !== undefined) {
    return cached;
  }
  baseIconPromise ??= fetchBaseIcon().catch(() => null);
  const base = await baseIconPromise;
  if (!base) {
    // Leave a failed fetch uncached so a later transition retries it.
    baseIconPromise = null;
    return null;
  }
  const inner =
    base.kind === "svg"
      ? nestBaseSvg(base.markup)
      : `<image href="${base.dataUri}" width="${ICON_CANVAS_SIZE}" height="${ICON_CANVAS_SIZE}"/>`;
  if (inner === null) {
    return null;
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_CANVAS_SIZE} ${ICON_CANVAS_SIZE}"` +
    ` width="${ICON_CANVAS_SIZE}" height="${ICON_CANVAS_SIZE}">` +
    `${inner}${tone === null ? "" : badgeMarkup(tone)}</svg>`;
  const frame = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  framesByTone.set(tone, frame);
  return frame;
};

export const resetBaseIconCache = (): void => {
  baseIconPromise = null;
  framesByTone.clear();
};
