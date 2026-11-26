import { hostShellWithCapability } from "@/lib/hostShell";

// eslint-disable-next-line lingui/no-unlocalized-strings
const START_SCREEN_CAPABILITY = "startScreen";

/**
 * Requests or images still loading this long after the app's layout appeared
 * do not hold the host's cover any longer.
 */
export const SETTLE_LIMIT_MS = 3000;

let inFlight = 0;
let stopCounting: (() => void) | null = null;
const onRequestEnd = new Set<() => void>();
let reported = false;

/**
 * A host app may cover the page while it starts, so a person sees one calm
 * screen instead of the page's loading steps (`startScreen` capability). This
 * says the page will report when it is drawn; a host lifts its cover early
 * for a page that does not say so. Call it before the page's first request.
 */
export function announceStartScreenReport(): void {
  const shell = hostShellWithCapability(START_SCREEN_CAPABILITY, 1);
  if (!shell) return;
  // eslint-disable-next-line lingui/no-unlocalized-strings
  void shell.request("startScreen.wait").catch(() => {});
  countRequests();
}

/**
 * Counts the requests in flight until the page has reported, so that data
 * fetched outside the query cache (theme, translations, the logo's settings)
 * holds the report too.
 */
function countRequests(): void {
  if (stopCounting) return;
  const original = window.fetch;
  const counting: typeof window.fetch = (...args) => {
    inFlight += 1;
    return Reflect.apply(original, window, args).finally(() => {
      inFlight -= 1;
      for (const listener of onRequestEnd) listener();
    });
  };
  window.fetch = counting;
  stopCounting = () => {
    if (window.fetch === counting) window.fetch = original;
    stopCounting = null;
  };
}

/**
 * Tells the host the page is drawn, once per page load, with the page's
 * background colour for its cover on the next start. Waits until no request
 * is in flight and the images on screen have arrived, at most `limitMs`.
 * Returns a function that stops waiting (the layout went away before).
 */
export function reportDrawnWhenSettled(limitMs = SETTLE_LIMIT_MS): () => void {
  const shell = hostShellWithCapability(START_SCREEN_CAPABILITY, 1);
  if (!shell || reported) return () => {};
  const controller = new AbortController();
  void whenSettled(limitMs, controller.signal).then(() => {
    if (controller.signal.aborted || reported) return;
    reported = true;
    stopCounting?.();
    void shell
      // eslint-disable-next-line lingui/no-unlocalized-strings
      .request("startScreen.ready", { background: pageBackground() ?? null })
      .catch(() => {});
  });
  return () => controller.abort();
}

/**
 * Resolves once no request is in flight and no image is on its way, and that
 * has held for two frames, so what arrived last is painted. Resolves at the
 * latest after `limitMs`, and at once when `signal` aborts.
 */
export function whenSettled(
  limitMs: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    let frame = 0;
    const waitingFor = new Set<HTMLImageElement>();

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(limit);
      window.cancelAnimationFrame(frame);
      onRequestEnd.delete(check);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const busy = () => inFlight > 0 || loadingImages().length > 0;
    function check() {
      if (finished) return;
      window.cancelAnimationFrame(frame);
      // Called again when a request ends.
      if (inFlight > 0) return;
      const images = loadingImages();
      if (images.length > 0) {
        for (const image of images) {
          if (waitingFor.has(image)) continue;
          waitingFor.add(image);
          image.addEventListener("load", check, { once: true });
          image.addEventListener("error", check, { once: true });
        }
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          if (busy()) check();
          else finish();
        });
      });
    }

    const limit = setTimeout(finish, limitMs);
    onRequestEnd.add(check);
    signal.addEventListener("abort", finish);
    if (signal.aborted) finish();
    else check();
  });
}

function loadingImages(): HTMLImageElement[] {
  return Array.from(document.images).filter(
    // A lazy image off screen does not load until scrolled to.
    (image) => !image.complete && image.loading !== "lazy",
  );
}

/**
 * The body's background as `#rrggbb`, for any CSS colour form (`oklch()`,
 * `color()`, what `color-mix()` computes to). Nothing for a see-through
 * colour or a gradient or image over it: the host then forgets the colour it
 * had, rather than showing a customer's old one.
 */
export function pageBackground(): string | undefined {
  const style = window.getComputedStyle(document.body);
  if (style.backgroundImage && style.backgroundImage !== "none") {
    return undefined;
  }
  return toHex(style.backgroundColor);
}

/** An opaque CSS colour as sRGB `#rrggbb`, painted into one canvas pixel. */
export function toHex(color: string): string | undefined {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  // eslint-disable-next-line lingui/no-unlocalized-strings
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return rgbToHex(color);
  // An unknown colour leaves the fill style as it was: transparent.
  context.fillStyle = "rgba(0, 0, 0, 0)";
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  if (alpha < 255) return undefined;
  return hex([red, green, blue]);
}

/** Without a canvas: the `rgb()` forms a computed style gives for sRGB. */
function rgbToHex(color: string): string | undefined {
  const match =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/.exec(
      color,
    );
  if (!match) return undefined;
  // Absent when the colour has no alpha part.
  const alpha = match[4] as string | undefined;
  if (alpha !== undefined && Number(alpha) < (match[5] ? 100 : 1)) {
    return undefined;
  }
  return hex([match[1], match[2], match[3]].map(Number));
}

function hex(channels: number[]): string {
  return `#${channels
    .map((channel) =>
      Math.min(255, Math.max(0, Math.round(channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
