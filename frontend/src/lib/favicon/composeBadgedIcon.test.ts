import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { composeBadgedIcon, resetBaseIconCache } from "./composeBadgedIcon";

const THEMED_SVG = `<svg viewBox="0 0 21 22" xmlns="http://www.w3.org/2000/svg">
  <style>.mark { fill: #050505; } @media (prefers-color-scheme: dark) { .mark { fill: #ffffff; } }</style>
  <path class="mark" d="M0 0h21v22H0z"/>
</svg>`;

const respondWith = (body: BodyInit, contentType: string) =>
  vi.fn().mockResolvedValue(
    new Response(body, {
      status: 200,
      headers: { "content-type": contentType },
    }),
  );

const decode = (dataUri: string) =>
  decodeURIComponent(dataUri.replace("data:image/svg+xml,", ""));

describe("composeBadgedIcon", () => {
  beforeEach(() => {
    resetBaseIconCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("nests the themed icon and stamps a toned dot", async () => {
    vi.stubGlobal("fetch", respondWith(THEMED_SVG, "image/svg+xml"));

    const svg = decode((await composeBadgedIcon("ready")) ?? "");

    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg).toContain('fill="#1f9d55"');
    expect(svg).toContain('viewBox="0 0 21 22"');
  });

  it("keeps the base icon's own colour-scheme rules inside the data URI", async () => {
    vi.stubGlobal("fetch", respondWith(THEMED_SVG, "image/svg+xml"));

    const svg = decode((await composeBadgedIcon("working")) ?? "");

    expect(svg).toContain("prefers-color-scheme: dark");
  });

  it("omits the dot for a null tone so the blink has an off frame", async () => {
    vi.stubGlobal("fetch", respondWith(THEMED_SVG, "image/svg+xml"));

    const svg = decode((await composeBadgedIcon(null)) ?? "");

    expect(svg).not.toContain("<circle");
  });

  it("embeds a raster base when the theme only ships an .ico", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith(new Uint8Array([1, 2, 3]), "image/x-icon"),
    );

    const svg = decode((await composeBadgedIcon("attention")) ?? "");

    expect(svg).toContain('<image href="data:image/x-icon;base64,');
    expect(svg).toContain('fill="#b4690e"');
  });

  it("fetches the base icon once across repeated composes", async () => {
    const fetchMock = respondWith(THEMED_SVG, "image/svg+xml");
    vi.stubGlobal("fetch", fetchMock);

    await composeBadgedIcon("working");
    await composeBadgedIcon(null);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the icon cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(composeBadgedIcon("working")).resolves.toBeNull();
  });
});
