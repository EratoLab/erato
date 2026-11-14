/**
 * A PowerPoint host for the reads' tests. Like Office.js, a proxy the host cannot serve does not
 * throw where it is touched: it fails the next `context.sync()`, and with it every read queued in
 * that batch.
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

const hostError = (message: string) =>
  Object.assign(new Error(message), { code: "GeneralException" });

export function installFakePowerPoint(deck: FakeDeck): FakePowerPointHost {
  const host: FakePowerPointHost = {
    textFrameAccesses: [],
    syncs: 0,
    failedSyncs: 0,
    runs: 0,
  };
  let poison: Error | null = null;
  const fail = (message: string) => {
    poison ??= hostError(message);
  };
  const loadable = <T extends object>(value: T) =>
    Object.assign(value, { load: () => value });

  const allShapes = (shapes: FakeShape[]): FakeShape[] =>
    shapes.flatMap((shape) => [shape, ...allShapes(shape.children ?? [])]);

  const textRange = (text: string) =>
    loadable({
      text,
      getSubstring: () => textRange(""),
    });

  const shapeProxy = (spec: FakeShape): object => {
    const hasTextFrame =
      TEXT_TYPES.has(spec.type) &&
      !(spec.holds && spec.holds !== "Placeholder");
    const raw = spec.text ?? "";
    const paragraphRange = (start: number) => {
      const index = raw.slice(0, start).split(/\r\n|\r|\n/).length - 1;
      const format = spec.paragraphs?.[index] ?? { level: 1 };
      return loadable({
        text: "",
        paragraphFormat: loadable({
          indentLevel: format.level,
          bulletFormat: loadable({
            visible: !!format.bullet,
            type: format.bullet ? "Unnumbered" : "None",
            style: format.bullet ?? "Unsupported",
          }),
        }),
      });
    };
    const frame = () =>
      loadable({
        isNullObject: false,
        hasText: raw.length > 0,
        textRange: Object.assign(textRange(raw), {
          getSubstring: (start: number) => paragraphRange(start),
        }),
      });
    return loadable({
      id: spec.id,
      name: spec.name ?? `Shape ${spec.id}`,
      type: spec.type,
      left: spec.left ?? 0,
      top: spec.top ?? 0,
      width: spec.width ?? 100,
      height: spec.height ?? 50,
      zOrderPosition: spec.z ?? 0,
      rotation: spec.rotation ?? 0,
      visible: spec.visible ?? true,
      altTextTitle: spec.altTextTitle ?? "",
      altTextDescription: spec.altTextDescription ?? "",
      isDecorative: spec.isDecorative ?? false,
      get textFrame() {
        host.textFrameAccesses.push(spec.id);
        if (!hasTextFrame) fail(`${spec.type} has no text frame`);
        return frame();
      },
      getTextFrameOrNullObject: () =>
        hasTextFrame
          ? frame()
          : loadable({
              isNullObject: true,
              hasText: false,
              get textRange() {
                fail("null object");
                return textRange("");
              },
            }),
      get placeholderFormat() {
        if (spec.type !== "Placeholder") fail("not a placeholder");
        return loadable({
          type: spec.role ?? "Body",
          containedType: spec.holds ?? null,
        });
      },
      getTable: () => {
        if (!spec.table) fail("not a table");
        const values = spec.table ?? [];
        return loadable({
          rowCount: values.length,
          columnCount: values[0]?.length ?? 0,
          values,
        });
      },
      get group() {
        if (spec.type !== "Group") fail("not a group");
        return {
          shapes: loadable({ items: (spec.children ?? []).map(shapeProxy) }),
        };
      },
    });
  };

  const slideProxy = (slide: FakeSlide) =>
    loadable({
      id: slide.id,
      isNullObject: false,
      layout: { name: slide.layout ?? "Title and Content" },
      slideMaster: { name: slide.master ?? "Office Theme" },
      shapes: loadable({ items: slide.shapes.map(shapeProxy) }),
    });

  const shapesById = () =>
    new Map(
      deck.slides
        .flatMap((slide) => allShapes(slide.shapes))
        .map((shape) => [shape.id, shape]),
    );

  const presentation = {
    slides: loadable({
      get items() {
        return deck.slides.map(slideProxy);
      },
      getItemOrNullObject: (id: string) => {
        const slide = deck.slides.find((candidate) => candidate.id === id);
        if (slide) return slideProxy(slide);
        return loadable({
          id: "",
          isNullObject: true,
          layout: { name: "" },
          get shapes() {
            fail("null slide");
            return loadable({ items: [] });
          },
        });
      },
    }),
    getSelectedSlides: () =>
      loadable({
        items: deck.slides
          .filter((slide) => deck.selectedSlideIds?.includes(slide.id))
          .map(slideProxy),
      }),
    getSelectedShapes: () => {
      const byId = shapesById();
      return loadable({
        items: (deck.selectedShapeIds ?? []).map((id) =>
          shapeProxy(byId.get(id)!),
        ),
      });
    },
    getSelectedTextRange: () => {
      if (deck.selectedText === undefined) fail("no text selected");
      return textRange(deck.selectedText ?? "");
    },
    pageSetup: loadable({
      slideWidth: deck.slideWidth ?? 960,
      slideHeight: deck.slideHeight ?? 540,
    }),
  };

  const context = {
    presentation,
    sync: () => {
      host.syncs += 1;
      if (poison) {
        const error = poison;
        poison = null;
        host.failedSyncs += 1;
        return Promise.reject(error);
      }
      return Promise.resolve();
    },
  };

  (globalThis as { PowerPoint?: unknown }).PowerPoint = {
    run: <T>(batch: (ctx: typeof context) => Promise<T>) => {
      host.runs += 1;
      poison = null;
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
