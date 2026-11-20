import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fakePngBase64,
  installFakePowerPoint,
  removeFakePowerPoint,
  requirementsUpTo,
} from "../../../test/mocks/powerpoint/fakePowerPoint";
import { powerpointReadSupport } from "../powerpointReadSupport";
import { readPowerPointSlide } from "../powerpointReads";
import { runPowerPoint } from "../powerpointRun";
import { pngSize, SLIDE_PICTURE_TIMEOUT_MS } from "../powerpointSlidePicture";
import {
  slidePictureTool,
  uploadErrorText,
  uploadSlidePicture,
} from "../powerpointViewSlide";

import type { FakeDeck } from "../../../test/mocks/powerpoint/fakePowerPoint";
import type { SlidePictureLimits } from "../powerpointViewSlide";
import type { ClientToolCallContext } from "@erato/frontend/library";

const mocks = vi.hoisted(() => ({
  fetchUploadFile: vi.fn(),
}));
vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock({
    fetchUploadFile: mocks.fetchUploadFile,
  });
});

afterEach(() => {
  removeFakePowerPoint();
  mocks.fetchUploadFile.mockReset();
  vi.useRealTimers();
});

const BASIC = powerpointReadSupport(requirementsUpTo("1.4"));
const LIMITS: SlidePictureLimits = { maxFiles: 10, maxBytes: 20 * 1024 * 1024 };

/** A PNG with a real header: signature and IHDR with width and height. */
function headerPngBase64(width: number, height: number): string {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return btoa(String.fromCharCode(...bytes));
}

const deck = (overrides: Partial<FakeDeck> = {}): FakeDeck => ({
  slides: ["256#", "257#", "258#"].map((id) => ({
    id,
    shapes: [],
    picture: id === "258#" ? headerPngBase64(960, 540) : undefined,
  })),
  selectedSlideIds: ["256#"],
  ...overrides,
});

let callCount = 0;
const context = (
  overrides: Partial<ClientToolCallContext> = {},
): ClientToolCallContext => ({
  toolCallId: `call-${++callCount}`,
  messageId: "turn-1",
  chatId: "chat-1",
  ...overrides,
});

const uploads = () => {
  const files: { file: File; chatId: string }[] = [];
  const upload = vi.fn(async (file: File, chatId: string) => {
    files.push({ file, chatId });
    return `file-${files.length}`;
  });
  return { files, upload };
};

describe("powerpoint_view_slide", () => {
  it("renders the named slide, not the selected one, adds it to the chat and returns only names and ids", async () => {
    const host = installFakePowerPoint(deck({ selectionFails: true }));
    const { files, upload } = uploads();
    const result = await slidePictureTool(upload)(
      { slideId: "258#" },
      context(),
      LIMITS,
    );
    expect(result).toEqual({
      ok: true,
      result: {
        slide: { id: "258#", position: 3, slideCount: 3 },
        picture: { fileName: "slide-3.png", width: 960, height: 540 },
      },
      fileUploadIds: ["file-1"],
    });
    expect(host.pictureRequests).toEqual([{ slideId: "258#", width: 960 }]);
    expect(
      files.map(({ file, chatId }) => [file.name, file.type, chatId]),
    ).toEqual([["slide-3.png", "image/png", "chat-1"]]);
    expect(JSON.stringify(result)).not.toContain(headerPngBase64(960, 540));
  });

  it("reads no presentation file and says nothing about whether the slide is hidden", async () => {
    const host = installFakePowerPoint(deck());
    const result = await slidePictureTool(uploads().upload)(
      { slideId: "257#" },
      context(),
      LIMITS,
    );
    expect(result).toMatchObject({
      ok: true,
      result: { picture: { fileName: "slide-2.png" } },
    });
    expect(host.exports).toBe(0);
    expect(host.fileOpens).toBe(0);
  });

  it("leaves out the size when the PNG has no header to read it from", async () => {
    installFakePowerPoint(deck());
    const result = await slidePictureTool(uploads().upload)(
      { slideId: "256#" },
      context(),
      LIMITS,
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok)
      expect((result.result as { picture: object }).picture).not.toHaveProperty(
        "width",
      );
  });

  it("answers an unknown slide id like the slide read, and uploads nothing", async () => {
    installFakePowerPoint(deck());
    const { upload } = uploads();
    const result = await slidePictureTool(upload)(
      { slideId: "999#" },
      context(),
      LIMITS,
    );
    expect(result).toEqual(
      await readPowerPointSlide(BASIC, { slideId: "999#" }),
    );
    expect(result).toMatchObject({ validationErrors: [{ path: "/slideId" }] });
    expect(upload).not.toHaveBeenCalled();
  });

  it("asks for a slide id when none is given", async () => {
    const host = installFakePowerPoint(deck());
    const tool = slidePictureTool();
    for (const input of [{}, { slideId: "" }, { slideId: 3 }, null])
      await expect(tool(input, context(), LIMITS)).resolves.toMatchObject({
        ok: false,
        error: "slideId must be a slide id from the overview.",
      });
    expect(host.runs).toBe(0);
  });

  it("makes at most three pictures in one turn and refuses the fourth in words the model can act on", async () => {
    installFakePowerPoint(deck());
    const { upload } = uploads();
    const tool = slidePictureTool(upload);
    for (const slideId of ["256#", "257#", "258#"])
      await expect(tool({ slideId }, context(), LIMITS)).resolves.toMatchObject(
        { ok: true },
      );
    await expect(tool({ slideId: "256#" }, context(), LIMITS)).resolves.toEqual(
      {
        ok: false,
        error:
          "No picture was made: this turn already asked for 3 slide pictures, the most one turn may ask for.",
      },
    );
    expect(upload).toHaveBeenCalledTimes(3);
    await expect(
      tool({ slideId: "256#" }, context({ messageId: "turn-2" }), LIMITS),
    ).resolves.toMatchObject({ ok: true });
  });

  it("counts a failed render and a failed upload, so retries end", async () => {
    installFakePowerPoint(deck({ pictureFails: true }));
    const failing = vi.fn(async () => {
      throw new Error("413 Payload Too Large");
    });
    const tool = slidePictureTool(failing);
    await expect(
      tool({ slideId: "256#" }, context(), LIMITS),
    ).resolves.toMatchObject({ error: expect.stringContaining("render") });
    removeFakePowerPoint();
    installFakePowerPoint(deck());
    for (let i = 0; i < 2; i++)
      await expect(
        tool({ slideId: "256#" }, context(), LIMITS),
      ).resolves.toMatchObject({ error: expect.stringContaining("uploaded") });
    await expect(
      tool({ slideId: "256#" }, context(), LIMITS),
    ).resolves.toMatchObject({
      error: expect.stringContaining("already asked for 3"),
    });
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("does not count an unknown slide id", async () => {
    installFakePowerPoint(deck());
    const tool = slidePictureTool(uploads().upload);
    for (let i = 0; i < 4; i++)
      await tool({ slideId: "999#" }, context(), LIMITS);
    const results = [];
    for (const slideId of ["256#", "257#", "258#"])
      results.push(await tool({ slideId }, context(), LIMITS));
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it("counts calls of one step that run at the same time", async () => {
    installFakePowerPoint(deck());
    const tool = slidePictureTool(uploads().upload);
    const results = await Promise.all(
      ["256#", "257#", "258#", "256#"].map((slideId) =>
        tool({ slideId }, context(), LIMITS),
      ),
    );
    expect(results.map((result) => result.ok)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("allows no more pictures per turn than the message may hold files", async () => {
    installFakePowerPoint(deck());
    const tool = slidePictureTool(uploads().upload);
    const limits = { ...LIMITS, maxFiles: 1 };
    await expect(
      tool({ slideId: "256#" }, context(), limits),
    ).resolves.toMatchObject({ ok: true });
    await expect(tool({ slideId: "257#" }, context(), limits)).resolves.toEqual(
      {
        ok: false,
        error:
          "No picture was made: this turn already asked for 1 slide picture, the most one turn may ask for.",
      },
    );
  });

  it("answers a replayed call with its first result instead of a second upload", async () => {
    const host = installFakePowerPoint(deck());
    const { upload } = uploads();
    const tool = slidePictureTool(upload);
    const call = context();
    const first = await tool({ slideId: "256#" }, call, LIMITS);
    const replay = await tool({ slideId: "256#" }, call, LIMITS);
    expect(replay).toBe(first);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(host.pictureRequests).toHaveLength(1);
  });

  it("says no picture was made when PowerPoint cannot render the slide", async () => {
    installFakePowerPoint(deck({ pictureFails: true }));
    const { upload } = uploads();
    await expect(
      slidePictureTool(upload)({ slideId: "256#" }, context(), LIMITS),
    ).resolves.toEqual({
      ok: false,
      error:
        "No picture was made: PowerPoint could not render slide 256# (GeneralException: slide picture failed).",
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it("says no picture was made when PowerPoint returns something that is not a PNG", async () => {
    installFakePowerPoint(
      deck({ slides: [{ id: "256#", shapes: [], picture: btoa("GIF89a") }] }),
    );
    await expect(
      slidePictureTool(uploads().upload)(
        { slideId: "256#" },
        context(),
        LIMITS,
      ),
    ).resolves.toEqual({
      ok: false,
      error:
        "No picture was made: PowerPoint could not render slide 256# (not a PNG).",
    });
  });

  it("gives up after the timeout and lets the next read through while the render still hangs", async () => {
    vi.useFakeTimers();
    const host = installFakePowerPoint(deck({ pictureHangs: true }));
    const { upload } = uploads();
    const pending = slidePictureTool(upload)(
      { slideId: "256#" },
      context(),
      LIMITS,
    );
    await vi.advanceTimersByTimeAsync(SLIDE_PICTURE_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({
      ok: false,
      error:
        "No picture was made: PowerPoint did not render slide 256# within 20 seconds.",
    });
    expect(upload).not.toHaveBeenCalled();
    vi.useRealTimers();
    await expect(
      readPowerPointSlide(BASIC, { slideId: "256#" }),
    ).resolves.toMatchObject({ ok: true });
    host.releaseHang();
  });

  it("counts the wait behind a hung call against the limit, and never starts the render afterwards", async () => {
    vi.useFakeTimers();
    const host = installFakePowerPoint(
      deck({ slideExports: { "256#": "hang" } }),
    );
    const stuck = runPowerPoint(async (ctx) => {
      ctx.presentation.slides.getItem("256#").exportAsBase64();
      await ctx.sync();
    });
    const pending = slidePictureTool(uploads().upload)(
      { slideId: "257#" },
      context(),
      LIMITS,
    );
    await vi.advanceTimersByTimeAsync(SLIDE_PICTURE_TIMEOUT_MS);
    await expect(pending).resolves.toMatchObject({
      error: expect.stringContaining("within 20 seconds"),
    });
    host.releaseHang();
    await stuck.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(host.pictureRequests).toEqual([]);
  });

  it("renders nothing for a turn that was stopped", async () => {
    const host = installFakePowerPoint(deck());
    const stop = new AbortController();
    stop.abort();
    const { upload } = uploads();
    await expect(
      slidePictureTool(upload)(
        { slideId: "256#" },
        context({ signal: stop.signal }),
        LIMITS,
      ),
    ).resolves.toEqual({
      ok: false,
      error: "No picture was made: the turn was stopped.",
    });
    expect(host.runs).toBe(0);
    expect(upload).not.toHaveBeenCalled();
  });

  it("renders nothing when the turn is stopped while the render waits behind another PowerPoint call", async () => {
    const host = installFakePowerPoint(
      deck({ slideExports: { "256#": "hang" } }),
    );
    const stuck = runPowerPoint(async (ctx) => {
      ctx.presentation.slides.getItem("256#").exportAsBase64();
      await ctx.sync();
    });
    const stop = new AbortController();
    const { upload } = uploads();
    const pending = slidePictureTool(upload)(
      { slideId: "257#" },
      context({ signal: stop.signal }),
      LIMITS,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop.abort();
    host.releaseHang();
    await stuck.catch(() => undefined);
    await expect(pending).resolves.toEqual({
      ok: false,
      error: "No picture was made: the turn was stopped.",
    });
    expect(host.pictureRequests).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads nothing over the chat's upload limit", async () => {
    installFakePowerPoint(deck());
    const { upload } = uploads();
    await expect(
      slidePictureTool(upload)({ slideId: "257#" }, context(), {
        ...LIMITS,
        maxBytes: 4,
      }),
    ).resolves.toEqual({
      ok: false,
      error:
        "No picture was added: the picture of slide 257# is larger than the chat's upload limit.",
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it("says no picture was added when the upload is refused, naming the server's answer", async () => {
    installFakePowerPoint(deck());
    await expect(
      slidePictureTool(async () => {
        throw {
          status: 413,
          payload: "Unexpected error (Unexpected end of JSON input)",
        };
      })({ slideId: "257#" }, context(), LIMITS),
    ).resolves.toEqual({
      ok: false,
      error:
        "No picture was added: the picture of slide 257# could not be uploaded to the chat (HTTP 413, too large).",
    });
  });

  it("makes nothing without a chat to add the picture to", async () => {
    const host = installFakePowerPoint(deck());
    const tool = slidePictureTool();
    for (const call of [context({ chatId: null }), undefined])
      await expect(tool({ slideId: "256#" }, call, LIMITS)).resolves.toEqual({
        ok: false,
        error: "No picture was made: this turn has no chat to add it to.",
      });
    expect(host.runs).toBe(0);
  });
});

describe("uploadSlidePicture", () => {
  it("uploads the file into the chat through the files API and returns its id", async () => {
    mocks.fetchUploadFile.mockResolvedValue({ files: [{ id: "file-9" }] });
    const file = new File([atob(fakePngBase64("x"))], "slide-2.png", {
      type: "image/png",
    });
    const signal = new AbortController().signal;
    await expect(uploadSlidePicture(file, "chat-1", signal)).resolves.toBe(
      "file-9",
    );
    const [variables, passedSignal] = mocks.fetchUploadFile.mock.calls[0];
    expect(variables.queryParams).toEqual({ chat_id: "chat-1" });
    expect((variables.body as FormData).get("file")).toBeInstanceOf(File);
    expect(passedSignal).toBe(signal);
  });

  it("fails when the server took no file", async () => {
    mocks.fetchUploadFile.mockResolvedValue({ files: [] });
    await expect(
      uploadSlidePicture(new File(["x"], "slide.png"), "chat-1"),
    ).rejects.toThrow("the server took no file");
  });
});

describe("uploadErrorText", () => {
  it("gives the status and a reason that reads the same in every browser", () => {
    const parser = (status: number) => ({
      status,
      payload: "Unexpected error (JSON.parse: unexpected end of data)",
    });
    expect(uploadErrorText(parser(413))).toBe("HTTP 413, too large");
    expect(uploadErrorText(parser(403))).toBe("HTTP 403, not allowed");
    expect(uploadErrorText(parser(400))).toBe("HTTP 400, not accepted");
    expect(uploadErrorText(parser(503))).toBe("HTTP 503, server error");
    expect(uploadErrorText(parser(302))).toBe("HTTP 302, refused");
    expect(
      uploadErrorText({
        name: "unknown",
        message: "Network error (Failed to fetch)",
      }),
    ).toBe("network error");
    expect(uploadErrorText(new Error("Network error (Load failed)"))).toBe(
      "network error",
    );
    expect(
      uploadErrorText(
        new DOMException("The user aborted a request.", "AbortError"),
      ),
    ).toBe("cancelled");
    expect(uploadErrorText(new Error("the server took no file"))).toBe(
      "the server took no file",
    );
    expect(uploadErrorText({})).toBe("unknown error");
  });

  it("never hands the model an object's default text", () => {
    for (const error of [{}, { status: "x" }, null, 42])
      expect(uploadErrorText(error)).not.toContain("[object");
  });
});

describe("pngSize", () => {
  it("reads width and height from the PNG header", () => {
    const bytes = Uint8Array.from(atob(headerPngBase64(960, 540)), (char) =>
      char.charCodeAt(0),
    );
    expect(pngSize(bytes)).toEqual({ width: 960, height: 540 });
    expect(pngSize(bytes.slice(0, 20))).toBeNull();
  });
});
