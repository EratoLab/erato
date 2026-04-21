import { describe, expect, it } from "vitest";

import { buildCfbWith, utf16le } from "../../test/fixtures/msg";
import {
  extractMsgInternetMessageId,
  extractMsgInternetMessageIdFromBytes,
} from "../extractMsgInternetMessageId";

describe("extractMsgInternetMessageIdFromBytes", () => {
  it("returns the Message-ID string when the stream is present", () => {
    const cfbBytes = buildCfbWith([
      {
        name: "__substg1.0_1035001F",
        content: utf16le("<abc123@example.com>"),
      },
    ]);
    expect(extractMsgInternetMessageIdFromBytes(cfbBytes)).toBe(
      "<abc123@example.com>",
    );
  });

  it("strips trailing UTF-16 null padding and whitespace", () => {
    const cfbBytes = buildCfbWith([
      {
        name: "__substg1.0_1035001F",
        content: utf16le("<abc@host>  \u0000\u0000"),
      },
    ]);
    expect(extractMsgInternetMessageIdFromBytes(cfbBytes)).toBe("<abc@host>");
  });

  it("returns null when the stream is missing", () => {
    const cfbBytes = buildCfbWith([
      {
        name: "__substg1.0_0037001F",
        content: utf16le("Some subject"),
      },
    ]);
    expect(extractMsgInternetMessageIdFromBytes(cfbBytes)).toBeNull();
  });

  it("returns null for an empty stream", () => {
    const cfbBytes = buildCfbWith([
      {
        name: "__substg1.0_1035001F",
        content: new Uint8Array(0),
      },
    ]);
    expect(extractMsgInternetMessageIdFromBytes(cfbBytes)).toBeNull();
  });

  it("returns null for non-CFB input", () => {
    expect(
      extractMsgInternetMessageIdFromBytes(new Uint8Array([1, 2, 3, 4])),
    ).toBeNull();
  });

  it("accepts a File via the async wrapper", async () => {
    const cfbBytes = buildCfbWith([
      {
        name: "__substg1.0_1035001F",
        content: utf16le("<xyz@host>"),
      },
    ]);
    const buffer = new ArrayBuffer(cfbBytes.length);
    new Uint8Array(buffer).set(cfbBytes);
    const file = new File([buffer], "sample.msg", {
      type: "application/vnd.ms-outlook",
    });
    expect(await extractMsgInternetMessageId(file)).toBe("<xyz@host>");
  });
});
