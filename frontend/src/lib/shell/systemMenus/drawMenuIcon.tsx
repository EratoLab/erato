/* eslint-disable lingui/no-unlocalized-strings -- CSS values and data URLs, never shown */
import { createRoot } from "react-dom/client";

import { iconKey } from "@/lib/shell/menus/menuEntry";
import { MenuIconView } from "@/lib/shell/menus/web/MenuIconView";

import type { ShellMenuIcon } from "@/lib/shell/contract/systemMenus";
import type { MenuIcon } from "@/lib/shell/menus/menuEntry";

/** 20 pt at the screen's 3x, the size a system menu shows an icon at. */
const PIXELS = 60;
/**
 * An icon loaded on demand settles once its drawing stops changing; until
 * then it shows ResolvedIcon's stand-in.
 */
const SETTLE_MS = 250;
const LIMIT_MS = 1500;

const drawn = new Map<string, Promise<ShellMenuIcon | undefined>>();

/**
 * The page's own icon as the PNG a host app's menu shows: drawn by the same
 * component as the web menu's, in black, so the app can tint its shape.
 * Undefined where it cannot be drawn; the entry then goes without one.
 */
export function drawMenuIcon(
  icon: MenuIcon,
): Promise<ShellMenuIcon | undefined> {
  const key = iconKey(icon);
  let drawing = drawn.get(key);
  if (!drawing) {
    drawing = render(icon).catch(() => undefined);
    drawn.set(key, drawing);
    // A failed drawing is tried again next time.
    void drawing.then((png) => {
      if (!png) drawn.delete(key);
    });
  }
  return drawing;
}

/** Whatever is drawn already, without waiting. */
export function drawnMenuIcon(icon: MenuIcon): ShellMenuIcon | undefined {
  return settledIcons.get(iconKey(icon));
}

const settledIcons = new Map<string, ShellMenuIcon>();

async function render(icon: MenuIcon): Promise<ShellMenuIcon | undefined> {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: `${PIXELS}px`,
    height: `${PIXELS}px`,
    color: "#000",
    pointerEvents: "none",
  });
  document.body.append(host);
  const root = createRoot(host);
  try {
    const settling = settled(host);
    root.render(<MenuIconView icon={icon} className="size-full" />);
    await settling;
    const svg = host.querySelector("svg");
    const png = svg ? await rasterize(svg) : undefined;
    if (png) settledIcons.set(iconKey(icon), png);
    return png;
  } finally {
    root.unmount();
    host.remove();
  }
}

function settled(host: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout>;
    const done = () => {
      observer.disconnect();
      clearTimeout(quiet);
      clearTimeout(limit);
      resolve();
    };
    const observer = new MutationObserver(() => {
      clearTimeout(quiet);
      quiet = setTimeout(done, SETTLE_MS);
    });
    observer.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    quiet = setTimeout(done, SETTLE_MS);
    const limit = setTimeout(done, LIMIT_MS);
  });
}

async function rasterize(
  svg: SVGSVGElement,
): Promise<ShellMenuIcon | undefined> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(PIXELS));
  copy.setAttribute("height", String(PIXELS));
  copy.style.color = "#000";
  const image = document.createElement("img");
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    new XMLSerializer().serializeToString(copy),
  )}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = PIXELS;
  canvas.height = PIXELS;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.drawImage(image, 0, 0, PIXELS, PIXELS);
  const png = canvas.toDataURL("image/png").split(",")[1];
  return png ? { png } : undefined;
}
