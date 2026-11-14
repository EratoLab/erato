import { powerpointErrorText, runPowerPoint } from "./powerpointRun";
import {
  capText,
  failed,
  isTitleRole,
  normalizePowerPointText,
  readEach,
  readingOrder,
  readShapeContent,
  shapeLoadPaths,
} from "./powerpointShapeRead";

import type { PowerPointReadSupport } from "./powerpointReadSupport";
import type { PowerPointShapeOut } from "./powerpointShapeRead";
import type { ClientToolExecutionResult } from "@erato/frontend/library";

/** Each result's JSON stays under this, like a Word read page. */
export const POWERPOINT_READ_MAX_BYTES = 20 * 1024;
const MAX_OVERVIEW_SLIDES = 300;
const MAX_HEADING_CHARACTERS = 200;

/** Nothing in PowerPoint's add-in API reads these, on any host. */
export const POWERPOINT_NEVER_READABLE = [
  "speaker notes",
  "comments",
  "chart data",
  "SmartArt text",
  "animations",
  "whether a slide is hidden",
];

/** What this host cannot read that a newer PowerPoint can, so a gap is never taken for "empty". */
export function powerpointHostLimits(support: PowerPointReadSupport): string[] {
  const limits: [boolean, string][] = [
    [support.placeholderRole, "placeholder roles (which shape is the title)"],
    [support.tables, "table contents"],
    [support.groups, "shapes inside groups"],
    [support.zOrder, "z-order"],
    [support.shapeDetails, "alt text, rotation and visibility"],
    [support.bulletLevels, "bullets and indent levels"],
    [support.slideSize, "slide size"],
  ];
  return limits.filter(([readable]) => !readable).map(([, what]) => what);
}

function envelope(support: PowerPointReadSupport) {
  const hostLimits = powerpointHostLimits(support);
  return {
    tier: support.tier,
    ...(hostLimits.length > 0
      ? { notReadableOnThisHost: hostLimits }
      : undefined),
    neverReadable: POWERPOINT_NEVER_READABLE,
  };
}

const encoder = new TextEncoder();
const jsonBytes = (value: unknown) =>
  encoder.encode(JSON.stringify(value)).length;

/**
 * Adds items to `result[key]` in order while the JSON stays under the cap. Always takes at least
 * one item, so a continuation never stalls.
 */
export function fitItems<T>(
  result: Record<string, unknown>,
  key: string,
  items: readonly T[],
  maxBytes = POWERPOINT_READ_MAX_BYTES,
): { taken: number } {
  const list: T[] = [];
  result[key] = list;
  // Room for the continuation fields the caller adds when items are left over.
  let bytes = jsonBytes(result) + 120;
  for (const item of items) {
    const itemBytes = jsonBytes(item) + 1;
    if (list.length > 0 && bytes + itemBytes > maxBytes) break;
    list.push(item);
    bytes += itemBytes;
  }
  return { taken: list.length };
}

type Input = Record<string, unknown>;

function invalid(path: string, message: string): ClientToolExecutionResult {
  return {
    ok: false,
    error: message,
    validationErrors: [{ path, code: "invalid", message }],
  };
}

function optionalInteger(
  input: Input,
  key: string,
  min: number,
): number | ClientToolExecutionResult {
  const value = input[key];
  if (value === undefined || value === null) return min;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min)
    return invalid(`/${key}`, `${key} must be an integer from ${min}.`);
  return value;
}

const asInput = (input: unknown): Input =>
  input && typeof input === "object" ? (input as Input) : {};

async function guarded(
  read: () => Promise<ClientToolExecutionResult>,
): Promise<ClientToolExecutionResult> {
  try {
    return await read();
  } catch (error) {
    return {
      ok: false,
      error: `PowerPoint could not be read: ${powerpointErrorText(error)}`,
    };
  }
}

export interface PowerPointSlideRef {
  id: string;
  position: number;
}

function positions(slides: PowerPoint.SlideCollection) {
  return new Map(slides.items.map((slide, i) => [slide.id, i + 1]));
}

export function readPowerPointPresentation(
  support: PowerPointReadSupport,
  rawInput: unknown,
): Promise<ClientToolExecutionResult> {
  const startSlide = optionalInteger(asInput(rawInput), "startSlide", 1);
  if (typeof startSlide !== "number") return Promise.resolve(startSlide);
  return guarded(() =>
    runPowerPoint(async (context) => {
      const { presentation } = context;
      const slides = presentation.slides.load(
        "items/id,items/layout/name,items/slideMaster/name",
      );
      await context.sync();

      const [selected] = support.selection
        ? await readEach(context, [presentation], (p) => {
            const scoped = p.getSelectedSlides().load("items/id");
            return () => scoped.items.map((slide) => slide.id);
          })
        : [];
      const [size] = support.slideSize
        ? await readEach(context, [presentation], (p) => {
            const setup = p.pageSetup.load("slideWidth,slideHeight");
            return () => ({
              width: Math.round(setup.slideWidth * 10) / 10,
              height: Math.round(setup.slideHeight * 10) / 10,
            });
          })
        : [];

      const start = startSlide - 1;
      const window = slides.items.slice(start, start + MAX_OVERVIEW_SLIDES);
      const headings = await readHeadings(context, window, support);
      const order = positions(slides);
      const rows = window.map((slide, i) => ({
        id: slide.id,
        position: order.get(slide.id) ?? start + i + 1,
        layout: slide.layout.name,
        master: slide.slideMaster.name,
        ...(headings[i] ? { heading: headings[i] } : {}),
      }));

      const result: Record<string, unknown> = {
        ...envelope(support),
        slideCount: slides.items.length,
        headingSource: support.placeholderRole
          ? "the slide's title placeholder"
          : "the topmost placeholder with text: this host cannot tell which shape is the title, so it may be something else",
        ...(selected && !failed(selected)
          ? { selectedSlideIds: selected }
          : support.selection
            ? {}
            : { selectedSlideIds: "not readable on this host" }),
        ...(size && !failed(size) ? { slideSize: size } : {}),
      };
      const { taken } = fitItems(result, "slides", rows);
      const next = start + taken;
      if (next < slides.items.length) result.nextStartSlide = next + 1;
      return { ok: true, result };
    }),
  );
}

/** Full tier: the title placeholder's text. Basic tier: the topmost placeholder that has text. */
async function readHeadings(
  context: PowerPoint.RequestContext,
  slides: readonly PowerPoint.Slide[],
  support: PowerPointReadSupport,
): Promise<(string | undefined)[]> {
  const shapeLists = await readEach(context, slides, (slide) => {
    const shapes = slide.shapes.load(
      "items/id,items/type,items/top,items/left",
    );
    return () => shapes.items;
  });
  const candidates: { slide: number; shape: PowerPoint.Shape }[] = [];
  if (support.placeholderRole) {
    const placeholders = shapeLists.flatMap((list, slide) =>
      failed(list)
        ? []
        : list
            .filter((shape) => shape.type === "Placeholder")
            .map((shape) => ({ slide, shape })),
    );
    const roles = await readEach(context, placeholders, ({ shape }) => {
      const format = shape.placeholderFormat.load("type");
      return () => format.type;
    });
    const seen = new Set<number>();
    placeholders.forEach((item, i) => {
      const role = roles[i];
      if (failed(role) || !isTitleRole(role) || seen.has(item.slide)) return;
      seen.add(item.slide);
      candidates.push(item);
    });
  } else {
    shapeLists.forEach((list, slide) => {
      if (failed(list)) return;
      const placeholders = list.filter((s) => s.type === "Placeholder");
      const topmost = readingOrder(
        placeholders.map((shape) => ({
          shape,
          box: { top: shape.top, left: shape.left },
        })),
      );
      // A second candidate covers a picture placeholder on top, whose text read fails.
      for (const { shape } of topmost.slice(0, 2))
        candidates.push({ slide, shape });
    });
  }
  const texts = await readEach(context, candidates, ({ shape }) => {
    const frame = support.safeTextFrame
      ? shape.getTextFrameOrNullObject()
      : shape.textFrame;
    const range = frame.textRange.load("text");
    return () => range.text;
  });
  const headings: (string | undefined)[] = slides.map(() => undefined);
  candidates.forEach(({ slide }, i) => {
    const text = texts[i];
    if (headings[slide] || failed(text)) return;
    const heading = normalizePowerPointText(text).replace(/\n+/g, " ").trim();
    if (heading)
      headings[slide] =
        heading.length > MAX_HEADING_CHARACTERS
          ? `${heading.slice(0, MAX_HEADING_CHARACTERS)}…`
          : heading;
  });
  return headings;
}

export function readPowerPointSlide(
  support: PowerPointReadSupport,
  rawInput: unknown,
): Promise<ClientToolExecutionResult> {
  const input = asInput(rawInput);
  const slideId = input.slideId;
  if (typeof slideId !== "string" || slideId.length === 0)
    return Promise.resolve(
      invalid("/slideId", "slideId must be a slide id from the overview."),
    );
  const startShape = optionalInteger(input, "startShape", 0);
  if (typeof startShape !== "number") return Promise.resolve(startShape);
  return guarded(() =>
    runPowerPoint(async (context) => {
      const all = context.presentation.slides.load("items/id");
      const slide = context.presentation.slides
        .getItemOrNullObject(slideId)
        .load("id,layout/name");
      const shapes = slide.shapes.load(shapeLoadPaths(support));
      try {
        await context.sync();
      } catch (error) {
        // A null slide makes its shapes fail; tell the two apart.
        if (slide.isNullObject) return slideNotFound(slideId);
        throw error;
      }
      if (slide.isNullObject) return slideNotFound(slideId);
      const read = readingOrder(
        await readShapeContent(context, shapes.items, support),
      );
      const result: Record<string, unknown> = {
        ...envelope(support),
        slide: {
          id: slide.id,
          position: positions(all).get(slide.id),
          layout: slide.layout.name,
        },
        shapeCount: read.length,
        ...(startShape > 0 ? { startShape } : {}),
      };
      const { taken } = fitItems(result, "shapes", read.slice(startShape));
      const next = startShape + taken;
      if (next < read.length) {
        result.nextStartShape = next;
        result.truncated = `Shapes ${next + 1}-${read.length} of ${read.length} were left out to keep this result small. Call again with startShape=${next} to read them.`;
      }
      return { ok: true, result };
    }),
  );
}

function slideNotFound(slideId: string): ClientToolExecutionResult {
  return invalid(
    "/slideId",
    `No slide has the id ${slideId}. Read the presentation overview for the current ids.`,
  );
}

export function readPowerPointSelection(
  support: PowerPointReadSupport,
): Promise<ClientToolExecutionResult> {
  return guarded(() =>
    runPowerPoint(async (context) => {
      const { presentation } = context;
      const all = presentation.slides.load("items/id");
      const slides = presentation.getSelectedSlides().load("items/id");
      const shapes = presentation
        .getSelectedShapes()
        .load(shapeLoadPaths(support));
      await context.sync();
      const order = positions(all);
      const selectedSlides = slides.items.map((slide) => ({
        id: slide.id,
        position: order.get(slide.id),
      }));
      const [text] = await readEach(context, [presentation], (p) => {
        const range = p.getSelectedTextRange().load("text");
        return () => range.text;
      });
      const selectedShapes: PowerPointShapeOut[] = readingOrder(
        await readShapeContent(context, shapes.items, support),
      );
      const result: Record<string, unknown> = {
        ...envelope(support),
        selectedSlides,
        ...(!failed(text) && text
          ? { selectedText: capText(normalizePowerPointText(text)) }
          : {}),
      };
      const { taken } = fitItems(result, "selectedShapes", selectedShapes);
      if (taken < selectedShapes.length)
        result.truncated = `${selectedShapes.length - taken} more selected shapes were left out to keep this result small; read their slide instead.`;
      return { ok: true, result };
    }),
  );
}
