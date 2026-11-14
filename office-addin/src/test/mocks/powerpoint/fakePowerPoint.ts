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
}

export interface FakeDeck {
  slides: FakeSlide[];
  selectedSlideIds?: string[];
  selectedShapeIds?: string[];
  selectedText?: string;
  /** getSelectedSlides fails its batch, as in a view that has no slide selection. */
  selectionFails?: boolean;
  slideWidth?: number;
  slideHeight?: number;
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
}

interface State {
  pending: (() => void)[];
  poison: Error | null;
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
  };
  const state: State = { pending: [], poison: null };
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
    });
  };

  const context = {
    presentation: {} as Record<string, unknown>,
    sync: () => {
      host.syncs += 1;
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
      context.presentation = {
        slides: presentation(),
        getSelectedSlides: () => {
          if (deck.selectionFails) fail("no selection in this view");
          return collection(
            state,
            deck.slides
              .filter((slide) => deck.selectedSlideIds?.includes(slide.id))
              .map(slideProxy),
          );
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
  return host;
}

export function removeFakePowerPoint() {
  delete (globalThis as { PowerPoint?: unknown }).PowerPoint;
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
