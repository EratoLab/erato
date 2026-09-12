import { beforeEach, describe, expect, it } from "vitest";

import { applyIconHref, restoreIconLinks } from "./iconLinkManager";

const seedOriginalLinks = () => {
  document.head.innerHTML =
    '<link rel="icon" href="/favicon.ico" sizes="any">' +
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">';
};

const iconLinks = () =>
  Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));

describe("iconLinkManager", () => {
  beforeEach(() => {
    seedOriginalLinks();
    restoreIconLinks();
    seedOriginalLinks();
  });

  it("leaves a single managed link so the browser cannot pick an original", () => {
    applyIconHref("data:image/svg+xml,badged");

    const links = iconLinks();
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("data:image/svg+xml,badged");
  });

  it("reuses the managed link across frames", () => {
    applyIconHref("data:image/svg+xml,on");
    const first = iconLinks()[0];

    applyIconHref("data:image/svg+xml,off");

    expect(iconLinks()[0]).toBe(first);
    expect(first.getAttribute("href")).toBe("data:image/svg+xml,off");
  });

  it("restores the originals with their selection attributes intact", () => {
    applyIconHref("data:image/svg+xml,badged");
    restoreIconLinks();

    const links = iconLinks();
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/favicon.ico",
      "/favicon.svg",
    ]);
    expect(links[0].getAttribute("sizes")).toBe("any");
    expect(links[1].getAttribute("type")).toBe("image/svg+xml");
  });

  it("is a no-op when restoring without an applied badge", () => {
    restoreIconLinks();

    expect(iconLinks()).toHaveLength(2);
  });
});
