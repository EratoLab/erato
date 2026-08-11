import { describe, expect, it } from "vitest";

import { disambiguatePastedImageFileNames } from "./disambiguatePastedImageFileNames";

describe("disambiguatePastedImageFileNames", () => {
  it("numbers clipboard-generated PNG and JPG names", () => {
    const files = disambiguatePastedImageFileNames(
      [
        new File(["png"], "image.png", { type: "image/png" }),
        new File(["jpg"], "image.jpg", { type: "image/jpeg" }),
      ],
      [],
    );

    expect(files.map((file) => file.name)).toEqual([
      "image1.png",
      "image1.jpg",
    ]);
  });

  it("continues numbering from existing names and within the same paste", () => {
    const files = disambiguatePastedImageFileNames(
      [
        new File(["one"], "image.png", { type: "image/png" }),
        new File(["two"], "image.png", { type: "image/png" }),
      ],
      ["image.png", "image1.png", "image3.png", "notes.txt"],
    );

    expect(files.map((file) => file.name)).toEqual([
      "image4.png",
      "image5.png",
    ]);
  });

  it("leaves non-clipboard filenames unchanged", () => {
    const file = new File(["content"], "screenshot.webp", {
      type: "image/webp",
    });

    expect(disambiguatePastedImageFileNames([file], ["image7.png"])).toEqual([
      file,
    ]);
  });
});
