import { describe, expect, it } from "vitest";

import { withLocalSizes } from "../useFileDropzone";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const uploaded = (id: string, filename: string): FileUploadItem =>
  ({
    id,
    filename,
    download_url: `https://example.invalid/${id}`,
  }) as FileUploadItem;

const local = (name: string, size: number) =>
  new File(["x".repeat(size)], name);

describe("withLocalSizes", () => {
  it("carries the picked file's size onto the server record", () => {
    const [result] = withLocalSizes(
      [uploaded("1", "report.pdf")],
      [local("report.pdf", 2048)],
    );

    expect(result).toMatchObject({ id: "1", size: 2048 });
  });

  it("matches by name rather than position, since response order is not contractual", () => {
    const result = withLocalSizes(
      [uploaded("1", "b.pdf"), uploaded("2", "a.pdf")],
      [local("a.pdf", 10), local("b.pdf", 20)],
    );

    expect(result).toMatchObject([
      { filename: "b.pdf", size: 20 },
      { filename: "a.pdf", size: 10 },
    ]);
  });

  it("leaves a duplicated name without a size rather than guessing", () => {
    const result = withLocalSizes(
      [uploaded("1", "shot.png"), uploaded("2", "shot.png")],
      [local("shot.png", 10), local("shot.png", 999)],
    );

    expect(result[0]).not.toHaveProperty("size");
    expect(result[1]).not.toHaveProperty("size");
  });

  it("passes through a record with no matching local file", () => {
    const [result] = withLocalSizes([uploaded("1", "server-only.pdf")], []);

    expect(result).not.toHaveProperty("size");
    expect(result.filename).toBe("server-only.pdf");
  });
});
