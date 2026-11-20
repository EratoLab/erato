import { describe, expect, it } from "vitest";

import {
  MAX_VIEW_DOWNLOAD_BYTES,
  viewDownloadName,
  viewDownloadOf,
} from "./download";

const png = (uri: string, blob: string) => [
  {
    type: "resource" as const,
    resource: { uri, mimeType: "image/png", blob },
  },
];

describe("viewDownloadName", () => {
  it("takes the URI's last segment, decoded, with the type's extension", () => {
    expect(viewDownloadName("ui://charts/revenue.png", ".png")).toBe(
      "revenue.png",
    );
    expect(viewDownloadName("file:///a/b/Q3%20sales.PNG?x=1#y", ".png")).toBe(
      "Q3 sales.png",
    );
    expect(viewDownloadName("ui://charts/revenue", ".svg")).toBe("revenue.svg");
    // Another extension stays part of the name.
    expect(viewDownloadName("ui://charts/chart.html", ".svg")).toBe(
      "chart.html.svg",
    );
  });

  it("drops path separators, reserved and control characters, and edge dots and spaces", () => {
    expect(viewDownloadName("ui://charts/..%2F..%2Fetc%2Fpasswd", ".png")).toBe(
      "etcpasswd.png",
    );
    expect(viewDownloadName("ui://x/a%5Cb%3Ac%2Ad%3F.png", ".png")).toBe(
      "abcd.png",
    );
    // A right-to-left override would make "gnp.exe" read as "exe.png".
    expect(viewDownloadName("ui://x/chart%E2%80%AEgnp.exe", ".png")).toBe(
      "chartgnp.exe.png",
    );
    expect(viewDownloadName("ui://x/%20.hidden.%20", ".png")).toBe(
      "hidden.png",
    );
  });

  it("caps the name and names a file whose URI names none", () => {
    const long = viewDownloadName(`ui://x/${"a".repeat(300)}.png`, ".png");
    expect(long).toBe(`${"a".repeat(100)}.png`);
    expect(viewDownloadName("ui://x/", ".png")).toBe("download.png");
    expect(viewDownloadName("ui://x/%E0%A4%A", ".svg")).toBe("%E0%A4%A.svg");
    expect(viewDownloadName("ui://x/...", ".svg")).toBe("download.svg");
  });
});

describe("viewDownloadOf", () => {
  it("takes one embedded PNG or SVG, as base64 or text", () => {
    expect(
      viewDownloadOf(png("ui://x/a.png", globalThis.btoa("png"))),
    ).toMatchObject({
      name: "a.png",
    });
    const svg = viewDownloadOf([
      {
        type: "resource",
        resource: {
          uri: "ui://x/a",
          mimeType: "image/svg+xml; charset=utf-8",
          text: "<svg/>",
        },
      },
    ]);
    expect(svg?.name).toBe("a.svg");
    expect(svg?.blob.size).toBe(6);
    // A type no browser shows, so its URL only downloads.
    expect(svg?.blob.type).toBe("application/octet-stream");
  });

  it("refuses several files, another type, bad base64 and a file over the limit", () => {
    const one = png("ui://x/a.png", globalThis.btoa("png"));
    expect(viewDownloadOf([...one, ...one])).toBeUndefined();
    expect(viewDownloadOf([])).toBeUndefined();
    expect(
      viewDownloadOf([
        {
          type: "resource",
          resource: { uri: "ui://x/a.gif", mimeType: "image/gif", blob: "R0" },
        },
      ]),
    ).toBeUndefined();
    expect(
      viewDownloadOf([
        { type: "resource", resource: { uri: "ui://x/a.png", text: "png" } },
      ]),
    ).toBeUndefined();
    expect(viewDownloadOf(png("ui://x/a.png", "not base64!"))).toBeUndefined();

    const atLimit = globalThis.btoa("x".repeat(MAX_VIEW_DOWNLOAD_BYTES));
    expect(viewDownloadOf(png("ui://x/a.png", atLimit))?.blob.size).toBe(
      MAX_VIEW_DOWNLOAD_BYTES,
    );
    const over = globalThis.btoa("x".repeat(MAX_VIEW_DOWNLOAD_BYTES + 1));
    expect(viewDownloadOf(png("ui://x/a.png", over))).toBeUndefined();
  });
});
