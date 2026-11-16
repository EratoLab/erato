import { afterEach, describe, expect, it } from "vitest";

import {
  officeHostHeaders,
  resetOfficeHostInfoForTests,
  setOfficeHostInfo,
} from "./clientPlatform";

afterEach(() => resetOfficeHostInfoForTests());

describe("officeHostHeaders", () => {
  it("sends nothing outside an Office pane", () => {
    expect(officeHostHeaders()).toEqual({});
  });

  it("merges what the shell and the host report into one header", () => {
    setOfficeHostInfo({
      host: "PowerPoint",
      platform: "PC",
      version: "16.0.20527.20000",
    });
    setOfficeHostInfo({ api: "1.10", tier: "full" });
    expect(officeHostHeaders()).toEqual({
      "X-Erato-Office-Host":
        "host=PowerPoint; platform=PC; version=16.0.20527.20000; api=1.10; tier=full",
    });
  });

  it("drops empty values and characters that would break the format", () => {
    setOfficeHostInfo({ host: "Word", version: "16.0; x=1" });
    setOfficeHostInfo({ version: undefined, platform: "Mac OS" });
    expect(officeHostHeaders()).toEqual({
      "X-Erato-Office-Host": "host=Word; platform=MacOS",
    });
  });
});
