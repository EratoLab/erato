import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fakePngBase64,
  installFakePowerPoint,
  removeFakePowerPoint,
} from "../../../test/mocks/powerpoint/fakePowerPoint";
import { runPowerPoint } from "../powerpointRun";
import {
  modelTakesSlidePictures,
  renderSelectedSlidePictures,
  SLIDE_PICTURE_TIMEOUT_MS,
  SLIDE_PICTURE_WIDTH,
} from "../powerpointSlidePicture";

import type { FakeDeck } from "../../../test/mocks/powerpoint/fakePowerPoint";
import type * as EratoLibrary from "@erato/frontend/library";

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  const actual = await vi.importActual<typeof EratoLibrary>(
    "@erato/frontend/library",
  );
  // The composer's own helpers, so the rule is tested against the frontend's.
  return mock.createEratoLibraryMock({
    findCapabilityByExtension: actual.findCapabilityByExtension,
    hasSupportedOperations: actual.hasSupportedOperations,
  });
});

const deck = (overrides: Partial<FakeDeck> = {}): FakeDeck => ({
  slides: ["256#", "257#", "258#", "259#", "260#"].map((id) => ({
    id,
    shapes: [],
  })),
  selectedSlideIds: ["257#"],
  ...overrides,
});

const bytesOf = async (file: File) =>
  String.fromCharCode(...new Uint8Array(await file.arrayBuffer()));

afterEach(() => {
  removeFakePowerPoint();
  vi.useRealTimers();
});

describe("renderSelectedSlidePictures", () => {
  it("renders the selected slide at the fixed width as a PNG named by its position", async () => {
    const host = installFakePowerPoint(deck());
    const result = await renderSelectedSlidePictures({ limit: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selectedCount).toBe(1);
    expect(host.pictureRequests).toEqual([
      { slideId: "257#", width: SLIDE_PICTURE_WIDTH },
    ]);
    const [picture] = result.pictures;
    expect(picture).toMatchObject({ slideId: "257#", slideNumber: 2 });
    expect(picture.file.name).toBe("slide-2.png");
    expect(picture.file.type).toBe("image/png");
    expect(await bytesOf(picture.file)).toBe(atob(fakePngBase64("257#")));
  });

  it("renders the first slides of the selection as PowerPoint lists them, active slide first, up to the limit", async () => {
    const host = installFakePowerPoint(
      deck({
        selectedSlideIds: ["256#", "257#", "260#", "259#", "258#"],
        activeSlideId: "259#",
      }),
    );
    const result = await renderSelectedSlidePictures({ limit: 3 });
    expect(result).toMatchObject({ ok: true, selectedCount: 5 });
    expect(host.pictureRequests.map((request) => request.slideId)).toEqual([
      "259#",
      "256#",
      "257#",
    ]);
    if (result.ok)
      expect(result.pictures.map((picture) => picture.file.name)).toEqual([
        "slide-4.png",
        "slide-1.png",
        "slide-2.png",
      ]);
  });

  it("accepts a picture that comes back as a data URL", async () => {
    installFakePowerPoint(
      deck({
        slides: [
          {
            id: "257#",
            shapes: [],
            picture: `data:image/png;base64,${fakePngBase64("257#")}`,
          },
        ],
      }),
    );
    const result = await renderSelectedSlidePictures({ limit: 3 });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(await bytesOf(result.pictures[0].file)).toBe(
        atob(fakePngBase64("257#")),
      );
  });

  it("asks for no picture when nothing is selected", async () => {
    const host = installFakePowerPoint(deck({ selectedSlideIds: [] }));
    expect(await renderSelectedSlidePictures({ limit: 3 })).toEqual({
      ok: false,
      reason: "nothing-selected",
    });
    expect(host.pictureRequests).toEqual([]);
  });

  it("reports a picture PowerPoint refuses as a failure with the host's reason", async () => {
    installFakePowerPoint(deck({ pictureFails: true }));
    expect(await renderSelectedSlidePictures({ limit: 3 })).toEqual({
      ok: false,
      reason: "failed",
      detail: "GeneralException: slide picture failed",
    });
  });

  it("refuses an answer that is not a PNG rather than attaching it", async () => {
    installFakePowerPoint(
      deck({
        slides: [{ id: "257#", shapes: [], picture: btoa("not a picture") }],
      }),
    );
    expect(await renderSelectedSlidePictures({ limit: 3 })).toMatchObject({
      ok: false,
      reason: "failed",
    });
  });

  it("gives up after the timeout, and later reads wait until PowerPoint answers", async () => {
    vi.useFakeTimers();
    const host = installFakePowerPoint(deck({ pictureHangs: true }));
    const render = renderSelectedSlidePictures({ limit: 3 });
    await vi.advanceTimersByTimeAsync(SLIDE_PICTURE_TIMEOUT_MS);
    expect(await render).toEqual({ ok: false, reason: "timeout" });

    let later = false;
    const next = runPowerPoint(async () => {
      later = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(later).toBe(false);
    host.releaseHang();
    await next;
    expect(later).toBe(true);
  });

  it("keeps the fake strict: a picture read before its sync fails", async () => {
    installFakePowerPoint(deck());
    await expect(
      runPowerPoint(async (context) => {
        const slides = context.presentation.slides.load("items/id");
        await context.sync();
        return slides.items[0].getImageAsBase64({ width: 100 }).value;
      }),
    ).rejects.toThrow(/PropertyNotLoaded/);
  });
});

describe("modelTakesSlidePictures", () => {
  const image = (
    operations: EratoLibrary.FileCapability["operations"],
    upload_allowed?: boolean,
  ): EratoLibrary.FileCapability => ({
    id: "image",
    extensions: ["jpg", "png"],
    mime_types: ["image/*"],
    operations,
    ...(upload_allowed === undefined ? {} : { upload_allowed }),
  });

  it("needs the selected model to understand images and the policy to allow the upload", () => {
    expect(modelTakesSlidePictures([image(["analyze_image"], true)])).toBe(
      true,
    );
    expect(modelTakesSlidePictures([image(["analyze_image"])])).toBe(true);
    expect(modelTakesSlidePictures([image(["analyze_image"], false)])).toBe(
      false,
    );
    // An upload policy that allows any file still leaves a model without vision blind.
    expect(modelTakesSlidePictures([image([], true)])).toBe(false);
  });

  it("offers nothing before the capabilities have loaded", () => {
    expect(modelTakesSlidePictures(undefined)).toBe(false);
    expect(modelTakesSlidePictures([])).toBe(false);
  });
});
