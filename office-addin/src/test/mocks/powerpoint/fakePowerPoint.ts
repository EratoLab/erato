import { base64 } from "./pptxFixture";

/**
 * A PowerPoint host for the reads' tests, strict where Office.js is:
 * - a property can be read only after a `load` naming it and a `sync` that succeeded;
 * - a proxy the host cannot serve does not throw where it is touched: it fails the next
 *   `context.sync()`, and with it every load queued in that batch.
 */
export interface FakeShape {
  id: string;
  name?: string;
  type: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  /** Raw text as the host returns it: \r between paragraphs, \v for a soft break. */
  text?: string;
  /** Placeholder role and what it holds. */
  role?: string;
  holds?: string;
  table?: string[][];
  children?: FakeShape[];
  /** One entry per paragraph of `text`. */
  paragraphs?: { level: number; bullet?: string }[];
  z?: number;
  rotation?: number;
  visible?: boolean;
  altTextTitle?: string;
  altTextDescription?: string;
  isDecorative?: boolean;
}

export interface FakeSlide {
  id: string;
  layout?: string;
  master?: string;
  shapes: FakeShape[];
  /** Base64 that getImageAsBase64 returns; a small PNG naming the slide by default. */
  picture?: string;
}

export interface FakeDeck {
  slides: FakeSlide[];
  /** In the order the user selected them, which getSelectedSlides keeps (PowerPoint for Windows). */
  selectedSlideIds?: string[];
  selectedShapeIds?: string[];
  selectedText?: string;
  /** getSelectedSlides fails its batch, as in a view that has no slide selection. */
  selectionFails?: boolean;
  slideWidth?: number;
  slideHeight?: number;
  /**
   * slide.exportAsBase64() by slide id: a one-slide .pptx, "fail" (its batch fails) or "hang" (its
   * sync answers only on `host.releaseHang()`). A slide without an entry fails its batch.
   */
  slideExports?: Record<string, Uint8Array | "fail" | "hang">;
  /** What Office.context.document.getFileAsync(Compressed) hands over; absent: the call fails. */
  file?: FakeFile;
  /** getImageAsBase64 fails its batch. */
  pictureFails?: boolean;
  /** A batch that asks for a slide picture settles only on `host.releaseHang()`. */
  pictureHangs?: boolean;
}

export interface FakeFile {
  bytes: Uint8Array;
  /** getFileAsync fails with this Office error code. */
  refuseCode?: number;
  hangOpen?: boolean;
  failSlice?: number;
  hangSlice?: number;
  /** Slices of this size whatever the caller asked for. */
  sliceSize?: number;
}

const TEXT_TYPES = new Set([
  "GeometricShape",
  "TextBox",
  "Placeholder",
  "Callout",
  "Freeform",
]);

export interface FakePowerPointHost {
  /** Every `.textFrame` access, by shape id. */
  textFrameAccesses: string[];
  syncs: number;
  failedSyncs: number;
  runs: number;
  exports: number;
  fileOpens: number;
  /** Handles getFileAsync handed out and closeAsync has not closed. */
  openFiles: number;
  slicesRead: number[];
  pictureRequests: { slideId: string; width?: number; height?: number }[];
  /** Lets a hung sync go on as if PowerPoint had answered late. */
  releaseHang: () => void;
}

interface State {
  pending: (() => void)[];
  poison: Error | null;
  hang: boolean;
}

const PNG_SIGNATURE = "\x89PNG\r\n\x1a\n";

/** Base64 of the PNG signature followed by `label`: enough for a check of the format. */
export function fakePngBase64(label: string): string {
  return btoa(PNG_SIGNATURE + label);
}

type Fake = Record<string, unknown> & {
  load: (spec?: string) => Fake;
  queue: (path: string[]) => void;
};

const hostError = (message: string) =>
  Object.assign(new Error(message), { code: "GeneralException" });

/**
 * An object whose scalars throw until loaded. `navigation` holds getters and methods; a getter
 * named in a load path is followed, so "layout/name" loads `layout.name`.
 */
function fake(
  state: State,
  scalars: Record<string, () => unknown>,
  navigation: object = {},
): Fake {
  const loaded = new Set<string>();
  const obj = {} as Fake;
  Object.defineProperties(obj, Object.getOwnPropertyDescriptors(navigation));
  for (const key of new Set([...Object.keys(scalars), "isNullObject"]))
    Object.defineProperty(obj, key, {
      enumerable: true,
      get() {
        if (!loaded.has(key))
          throw new Error(
            `PropertyNotLoaded: ${key} was read before load and sync`,
          );
        return key === "isNullObject"
          ? (scalars.isNullObject?.() ?? false)
          : scalars[key]();
      },
    });
  obj.queue = (path) => {
    state.pending.push(() => loaded.add("isNullObject"));
    const [head, ...rest] = path;
    if (!head) return;
    if (rest.length === 0 && head in scalars) {
      state.pending.push(() => loaded.add(head));
      return;
    }
    const next = (obj as Record<string, unknown>)[head] as Fake | undefined;
    if (!next || typeof next.queue !== "function")
      throw new Error(`fake: cannot load ${path.join("/")}`);
    next.queue(rest);
  };
  obj.load = (spec = "") => {
    for (const path of spec
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean))
      obj.queue(path.split("/"));
    if (!spec) obj.queue([]);
    return obj;
  };
  return obj;
}

function collection(state: State, items: Fake[]): Fake {
  let loaded = false;
  const obj = {} as Fake;
  Object.defineProperty(obj, "items", {
    get() {
      if (!loaded) throw new Error("PropertyNotLoaded: items");
      return items;
    },
  });
  obj.queue = ([head, ...rest]) => {
    if (head !== "items") throw new Error(`fake: cannot load ${head}`);
    state.pending.push(() => {
      loaded = true;
    });
    for (const item of items) item.queue(rest);
  };
  obj.load = (spec = "") => {
    for (const path of spec
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean))
      obj.queue(path.split("/"));
    return obj;
  };
  return obj;
}

export function installFakePowerPoint(deck: FakeDeck): FakePowerPointHost {
  const host: FakePowerPointHost = {
    textFrameAccesses: [],
    syncs: 0,
    failedSyncs: 0,
    runs: 0,
    exports: 0,
    fileOpens: 0,
    openFiles: 0,
    slicesRead: [],
    pictureRequests: [],
    releaseHang: () => {},
  };
  const state: State = { pending: [], poison: null, hang: false };
  const fail = (message: string) => {
    state.poison ??= hostError(message);
  };

  const allShapes = (shapes: FakeShape[]): FakeShape[] =>
    shapes.flatMap((shape) => [shape, ...allShapes(shape.children ?? [])]);

  const shapeProxy = (spec: FakeShape): Fake => {
    const hasTextFrame =
      TEXT_TYPES.has(spec.type) && !(spec.holds && !TEXT_TYPES.has(spec.holds));
    const raw = spec.text ?? "";
    const paragraphAt = (start: number) =>
      raw.slice(0, start).split(/\r\n|\r|\n/).length - 1;
    const range = (start: number, length: number): Fake => {
      const format = spec.paragraphs?.[paragraphAt(start)] ?? { level: 1 };
      return fake(
        state,
        { text: () => raw.slice(start, start + length) },
        {
          getSubstring: (offset: number, count: number) => {
            if (offset < 0 || offset + count > length)
              fail("getSubstring out of range");
            return range(start + offset, count);
          },
          paragraphFormat: fake(
            state,
            { indentLevel: () => format.level },
            {
              bulletFormat: fake(state, {
                visible: () => !!format.bullet,
                type: () => (format.bullet ? "Unnumbered" : "None"),
                style: () => format.bullet ?? "Unsupported",
              }),
            },
          ),
        },
      );
    };
    const frame = () =>
      fake(
        state,
        { hasText: () => raw.length > 0 },
        { textRange: range(0, raw.length) },
      );
    const nullFrame = () =>
      fake(
        state,
        { hasText: () => false, isNullObject: () => true },
        {
          get textRange() {
            fail("null object");
            return range(0, 0);
          },
        },
      );
    const tableValues = spec.table ?? [];
    return fake(
      state,
      {
        id: () => spec.id,
        name: () => spec.name ?? `Shape ${spec.id}`,
        type: () => spec.type,
        left: () => spec.left ?? 0,
        top: () => spec.top ?? 0,
        width: () => spec.width ?? 100,
        height: () => spec.height ?? 50,
        zOrderPosition: () => spec.z ?? 0,
        rotation: () => spec.rotation ?? 0,
        visible: () => spec.visible ?? true,
        altTextTitle: () => spec.altTextTitle ?? "",
        altTextDescription: () => spec.altTextDescription ?? "",
        isDecorative: () => spec.isDecorative ?? false,
      },
      {
        get textFrame() {
          host.textFrameAccesses.push(spec.id);
          if (!hasTextFrame) fail(`${spec.type} has no text frame`);
          return frame();
        },
        getTextFrameOrNullObject: () => (hasTextFrame ? frame() : nullFrame()),
        get placeholderFormat() {
          if (spec.type !== "Placeholder") fail("not a placeholder");
          // Documented: null only for an empty placeholder.
          return fake(state, {
            type: () => spec.role ?? "Body",
            containedType: () => spec.holds ?? (raw ? "TextBox" : null),
          });
        },
        getTable: () => {
          if (!spec.table) fail("not a table");
          return fake(state, {
            rowCount: () => tableValues.length,
            columnCount: () => tableValues[0]?.length ?? 0,
            values: () => tableValues,
          });
        },
        get group() {
          if (spec.type !== "Group") fail("not a group");
          return {
            shapes: collection(state, (spec.children ?? []).map(shapeProxy)),
          };
        },
      },
    );
  };

  const slideProxy = (slide: FakeSlide): Fake => {
    const shapes = collection(state, slide.shapes.map(shapeProxy));
    return fake(
      state,
      { id: () => slide.id },
      {
        layout: fake(state, {
          name: () => slide.layout ?? "Title and Content",
        }),
        slideMaster: fake(state, {
          name: () => slide.master ?? "Office Theme",
        }),
        shapes,
        exportAsBase64: () => {
          host.exports += 1;
          const exported = deck.slideExports?.[slide.id];
          if (exported === "hang") state.hang = true;
          else if (!exported || exported === "fail") fail("export failed");
          const result = fake(state, {
            value: () =>
              exported instanceof Uint8Array ? base64(exported) : "",
          });
          result.queue(["value"]);
          return result;
        },
        getImageAsBase64: (options?: { width?: number; height?: number }) => {
          host.pictureRequests.push({ slideId: slide.id, ...options });
          if (deck.pictureFails) fail("slide picture failed");
          if (deck.pictureHangs) state.hang = true;
          let ready = false;
          state.pending.push(() => {
            ready = true;
          });
          return {
            get value() {
              if (!ready)
                throw new Error(
                  "PropertyNotLoaded: value was read before sync",
                );
              return slide.picture ?? fakePngBase64(slide.id);
            },
          };
        },
      },
    );
  };
  const nullSlide = (): Fake =>
    fake(
      state,
      { id: () => "", isNullObject: () => true },
      {
        layout: fake(state, { name: () => "" }),
        get shapes() {
          fail("null slide");
          return collection(state, []);
        },
      },
    );

  const shapesById = () =>
    new Map(
      deck.slides
        .flatMap((slide) => allShapes(slide.shapes))
        .map((shape) => [shape.id, shape]),
    );

  const presentation = () => {
    const slides = deck.slides.map(slideProxy);
    const slideCollection = collection(state, slides);
    return Object.assign(slideCollection, {
      getItemOrNullObject: (id: string) => {
        const index = deck.slides.findIndex((slide) => slide.id === id);
        return index >= 0 ? slides[index] : nullSlide();
      },
      getItem: (id: string) => {
        const index = deck.slides.findIndex((slide) => slide.id === id);
        if (index < 0) fail("ItemNotFound");
        return index >= 0 ? slides[index] : nullSlide();
      },
    });
  };

  const context = {
    presentation: {} as Record<string, unknown>,
    sync: (): Promise<void> => {
      host.syncs += 1;
      if (state.hang) {
        state.hang = false;
        return new Promise<void>((resolve, reject) => {
          host.releaseHang = () => {
            host.syncs -= 1;
            context.sync().then(resolve, reject);
          };
        });
      }
      const poison = state.poison;
      const pending = state.pending;
      state.poison = null;
      state.pending = [];
      if (poison) {
        host.failedSyncs += 1;
        return Promise.reject(poison);
      }
      for (const apply of pending) apply();
      return Promise.resolve();
    },
  };

  (globalThis as { PowerPoint?: unknown }).PowerPoint = {
    run: <T>(batch: (ctx: typeof context) => Promise<T>) => {
      host.runs += 1;
      state.poison = null;
      state.pending = [];
      state.hang = false;
      context.presentation = {
        slides: presentation(),
        getSelectedSlides: () => {
          if (deck.selectionFails) fail("no selection in this view");
          const selected = (deck.selectedSlideIds ?? []).flatMap((id) =>
            deck.slides.filter((slide) => slide.id === id),
          );
          return collection(state, selected.map(slideProxy));
        },
        getSelectedShapes: () => {
          const byId = shapesById();
          return collection(
            state,
            (deck.selectedShapeIds ?? []).map((id) =>
              shapeProxy(byId.get(id)!),
            ),
          );
        },
        getSelectedTextRange: () => {
          if (deck.selectedText === undefined) fail("no text selected");
          return fake(state, { text: () => deck.selectedText ?? "" });
        },
        pageSetup: fake(state, {
          slideWidth: () => deck.slideWidth ?? 960,
          slideHeight: () => deck.slideHeight ?? 540,
        }),
      };
      return batch(context);
    },
  };
  installFakeFile(deck, host);
  return host;
}

const officeGlobal = () =>
  (
    globalThis as unknown as {
      Office: { context: Record<string, unknown>; FileType?: unknown };
    }
  ).Office;

/** getFileAsync as Office.js documents it: a handle, sliced reads, closeAsync, two handles at most. */
function installFakeFile(deck: FakeDeck, host: FakePowerPointHost) {
  const office = officeGlobal();
  office.FileType = { Compressed: "compressed" };
  const later = (fn: () => void) => setTimeout(fn, 0);
  office.context.document = {
    getFileAsync: (
      _type: string,
      options: { sliceSize?: number },
      callback: (result: unknown) => void,
    ) => {
      const file = deck.file;
      if (file?.hangOpen) return;
      if (!file || file.refuseCode !== undefined || host.openFiles >= 2) {
        later(() =>
          callback({
            status: "failed",
            error: {
              code: host.openFiles >= 2 ? 11000 : (file?.refuseCode ?? 5001),
              message: "fake refusal",
            },
          }),
        );
        return;
      }
      host.fileOpens += 1;
      host.openFiles += 1;
      const bytes = new Uint8Array(file.bytes);
      const sliceSize = file.sliceSize ?? options.sliceSize ?? 4194304;
      let closed = false;
      later(() =>
        callback({
          status: "succeeded",
          value: {
            size: bytes.length,
            sliceCount: Math.ceil(bytes.length / sliceSize),
            getSliceAsync: (index: number, done: (result: unknown) => void) => {
              if (closed) throw new Error("fake: slice read after closeAsync");
              host.slicesRead.push(index);
              if (index === file.hangSlice) return;
              const data = bytes.slice(
                index * sliceSize,
                (index + 1) * sliceSize,
              );
              later(() =>
                done(
                  index === file.failSlice
                    ? {
                        status: "failed",
                        error: { code: 5001, message: "fake" },
                      }
                    : {
                        status: "succeeded",
                        value: {
                          index,
                          size: data.length,
                          data: Array.from(data),
                        },
                      },
                ),
              );
            },
            closeAsync: (done: () => void) => {
              if (!closed) host.openFiles -= 1;
              closed = true;
              later(done);
            },
          },
        }),
      );
    },
  };
}

export function removeFakePowerPoint() {
  delete (globalThis as { PowerPoint?: unknown }).PowerPoint;
  const office = officeGlobal();
  delete office.context.document;
  delete office.FileType;
}

/** isSetSupported for a host whose highest PowerPointApi is `highest`. */
export function requirementsUpTo(highest: string) {
  const [major, minor] = highest.split(".").map(Number);
  return (name: string, version?: string) => {
    if (name !== "PowerPointApi" || !version) return false;
    const [vMajor, vMinor] = version.split(".").map(Number);
    return vMajor < major || (vMajor === major && vMinor <= minor);
  };
}
