import { POWERPOINT_FILE_LIMITS } from "./powerpointFile";
import {
  POWERPOINT_FILE_CONTENT,
  SAVED_FILE_NOTE,
  fileCouldFill,
  hasFileRoute,
  slideFileFields,
  withFileContent,
} from "./powerpointFileContent";
import { powerpointErrorText, runPowerPoint } from "./powerpointRun";
import {
  capShape,
  capText,
  failed,
  isTitleRole,
  jsonBytes,
  normalizePowerPointText,
  POWERPOINT_HOST_LIMITS,
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
/** One shape's share: the envelope and continuation fields take well under the rest. */
const MAX_SHAPE_BYTES = POWERPOINT_READ_MAX_BYTES - 4 * 1024;
/** Headings are read for this many slides per call; about this many fit a page. */
const OVERVIEW_WINDOW = 100;
const MAX_HEADING_CHARACTERS = 200;
export const MAX_LISTED_SELECTED_SLIDES = 50;

/** Nothing in PowerPoint's add-in API reads these, on any host. */
export const POWERPOINT_NEVER_READABLE = [
  "speaker notes",
  "comments",
  "chart data",
  "SmartArt text",
  "animations",
  "whether a slide is hidden",
];
/** Neither the add-in API nor this pane's file reader reads these. */
export const POWERPOINT_NEVER_READABLE_WITH_FILE = ["comments", "animations"];

/** Slide reads take these from the presentation file where the host has no API for them. */
const FILE_FILLS: (keyof typeof POWERPOINT_HOST_LIMITS)[] = [
  "tables",
  "groups",
];

/** What this host cannot read that a newer PowerPoint can, so a gap is never taken for "empty". */
export function powerpointHostLimits(support: PowerPointReadSupport): string[] {
  return (
    Object.entries(POWERPOINT_HOST_LIMITS) as [
      keyof typeof POWERPOINT_HOST_LIMITS,
      string,
    ][]
  )
    .filter(
      ([feature]) =>
        !support[feature] &&
        !(support.presentationFile && FILE_FILLS.includes(feature)),
    )
    .map(([, what]) => what);
}

function envelope(support: PowerPointReadSupport, overview = false) {
  const hostLimits = powerpointHostLimits(support);
  const fileRoute = hasFileRoute(support);
  return {
    tier: support.tier,
    ...(hostLimits.length > 0
      ? { notReadableOnThisHost: hostLimits }
      : undefined),
    neverReadable: fileRoute
      ? POWERPOINT_NEVER_READABLE_WITH_FILE
      : POWERPOINT_NEVER_READABLE,
    ...(fileRoute && overview
      ? { onlyInSlideReads: POWERPOINT_FILE_CONTENT }
      : undefined),
  };
}

/**
 * Adds items to `result[key]` in order while the JSON stays under the cap. Always takes at least
 * one item, so a continuation never stalls; callers cap each item well below the page.
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
  let bytes = jsonBytes(result) + 300;
  for (const item of items) {
    const itemBytes = jsonBytes(item) + 1;
    if (list.length > 0 && bytes + itemBytes > maxBytes) break;
    list.push(item);
    bytes += itemBytes;
  }
  return { taken: list.length };
}

type Input = Record<string, unknown>;

export function invalid(
  path: string,
  message: string,
): ClientToolExecutionResult {
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

export function positions(slides: PowerPoint.SlideCollection) {
  return new Map(slides.items.map((slide, i) => [slide.id, i + 1]));
}

/** A selection of hundreds of slides (Ctrl+A in the thumbnails) is named by count past the cap. */
function selectedSlideList<T>(all: readonly T[]) {
  return {
    listed: all.slice(0, MAX_LISTED_SELECTED_SLIDES),
    ...(all.length > MAX_LISTED_SELECTED_SLIDES
      ? { selectedSlideCount: all.length }
      : {}),
  };
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

      const unread: string[] = [];
      const [selected] = support.selection
        ? await readEach(context, [presentation], (p) => {
            const scoped = p.getSelectedSlides().load("items/id");
            return () => scoped.items.map((slide) => slide.id);
          })
        : [];
      if (support.selection && (selected === undefined || failed(selected)))
        unread.push("selected slides: PowerPoint refused to read them");
      const [size] = support.slideSize
        ? await readEach(context, [presentation], (p) => {
            const setup = p.pageSetup.load("slideWidth,slideHeight");
            return () => ({
              width: Math.round(setup.slideWidth * 10) / 10,
              height: Math.round(setup.slideHeight * 10) / 10,
            });
          })
        : [];
      if (support.slideSize && (size === undefined || failed(size)))
        unread.push("slide size: PowerPoint refused to read it");

      const start = startSlide - 1;
      const window = slides.items.slice(start, start + OVERVIEW_WINDOW);
      const headings = await readHeadings(context, window, support);
      const order = positions(slides);
      const rows = window.map((slide, i) => ({
        id: slide.id,
        position: order.get(slide.id) ?? start + i + 1,
        layout: slide.layout.name,
        master: slide.slideMaster.name,
        ...(headings[i] ? { heading: headings[i] } : {}),
      }));

      const selection =
        selected && !failed(selected) ? selectedSlideList(selected) : null;
      const result: Record<string, unknown> = {
        ...envelope(support, true),
        slideCount: slides.items.length,
        headingSource: support.placeholderRole
          ? "the slide's title placeholder"
          : "the topmost placeholder with text: this host cannot tell which shape is the title, so it may be something else",
        ...(selection
          ? {
              selectedSlideIds: selection.listed,
              ...("selectedSlideCount" in selection
                ? { selectedSlideCount: selection.selectedSlideCount }
                : {}),
            }
          : {}),
        ...(size && !failed(size) ? { slideSize: size } : {}),
        ...(unread.length > 0 ? { unread } : {}),
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
  const headings: (string | undefined)[] = slides.map(() => undefined);
  const readTexts = async (
    candidates: { slide: number; shape: PowerPoint.Shape }[],
  ) => {
    const texts = await readEach(context, candidates, ({ shape }) => {
      const frame = support.safeTextFrame
        ? shape.getTextFrameOrNullObject()
        : shape.textFrame;
      const range = frame.textRange.load("text");
      return () => range.text;
    });
    candidates.forEach(({ slide }, i) => {
      const text = texts[i];
      if (headings[slide] || failed(text) || typeof text !== "string") return;
      const heading = normalizePowerPointText(text).replace(/\n+/g, " ").trim();
      if (heading)
        headings[slide] =
          heading.length > MAX_HEADING_CHARACTERS
            ? `${heading.slice(0, MAX_HEADING_CHARACTERS)}…`
            : heading;
    });
  };

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
    const titles = placeholders.filter((item, i) => {
      const role = roles[i];
      if (failed(role) || !isTitleRole(role) || seen.has(item.slide))
        return false;
      seen.add(item.slide);
      return true;
    });
    await readTexts(titles);
    return headings;
  }
  // The topmost placeholder first; the next one only where that gave nothing, e.g. a picture
  // placeholder on top. Asking every slide's second placeholder would touch chart and table
  // placeholders whose text read fails the batch.
  const ordered = shapeLists.map((list) =>
    failed(list)
      ? []
      : readingOrder(
          list
            .filter((shape) => shape.type === "Placeholder")
            .map((shape) => ({
              shape,
              box: { top: shape.top, left: shape.left },
            })),
        ).map(({ shape }) => shape),
  );
  for (const round of [0, 1])
    await readTexts(
      ordered.flatMap((shapes, slide) =>
        !headings[slide] && shapes[round]
          ? [{ slide, shape: shapes[round] }]
          : [],
      ),
    );
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
  const deadline = Date.now() + POWERPOINT_FILE_LIMITS.fileDeadlineMs;
  return guarded(async () => {
    const live = await runPowerPoint(async (context) => {
      const all = context.presentation.slides.load("items/id");
      const slide = context.presentation.slides
        .getItemOrNullObject(slideId)
        .load("id,layout/name");
      await context.sync();
      if (slide.isNullObject) return null;
      const shapes = slide.shapes.load(shapeLoadPaths(support));
      await context.sync();
      return {
        id: slide.id,
        position: positions(all).get(slide.id) ?? 0,
        slideCount: all.items.length,
        layout: slide.layout.name,
        shapes: readingOrder(
          await readShapeContent(context, shapes.items, support),
        ),
      };
    });
    if (!live) return slideNotFound(slideId);
    const file = hasFileRoute(support)
      ? slideFileFields(
          await withFileContent(
            support,
            live,
            live.shapes,
            live.shapes,
            deadline,
          ),
          startShape === 0,
        )
      : {};
    const result: Record<string, unknown> = {
      ...envelope(support),
      slide: {
        id: live.id,
        position: live.position,
        layout: live.layout,
        ...file,
      },
      shapeCount: live.shapes.length,
      ...(startShape > 0 ? { startShape } : {}),
    };
    // Notes share the page, so a shape gets at most what is left beside them.
    const room = Math.min(
      MAX_SHAPE_BYTES,
      POWERPOINT_READ_MAX_BYTES - jsonBytes(result) - 600,
    );
    const read = live.shapes.map((shape) => capShape(shape, room));
    const { taken } = fitItems(result, "shapes", read.slice(startShape));
    const next = startShape + taken;
    if (next < read.length) {
      result.nextStartShape = next;
      result.truncated = `Shapes ${next + 1}-${read.length} of ${read.length} were left out to keep this result small. Call again with startShape=${next} to read them.`;
    }
    return { ok: true, result };
  });
}

export function slideNotFound(slideId: string): ClientToolExecutionResult {
  return invalid(
    "/slideId",
    `No slide has the id ${slideId}. Read the presentation overview for the current ids.`,
  );
}

export function readPowerPointSelection(
  support: PowerPointReadSupport,
): Promise<ClientToolExecutionResult> {
  const deadline = Date.now() + POWERPOINT_FILE_LIMITS.fileDeadlineMs;
  return guarded(async () => {
    const live = await runPowerPoint(async (context) => {
      const { presentation } = context;
      const all = presentation.slides.load("items/id");
      const slides = presentation.getSelectedSlides().load("items/id");
      const shapes = presentation
        .getSelectedShapes()
        .load(shapeLoadPaths(support));
      await context.sync();
      const order = positions(all);
      const [text] = await readEach(context, [presentation], (p) => {
        const range = p.getSelectedTextRange().load("text");
        return () => range.text;
      });
      const selected = readingOrder(
        await readShapeContent(context, shapes.items, support),
      );
      // Selected shapes sit on the slide being edited, known for sure only when one slide is
      // selected. The file is checked against all of that slide's shapes, as a slide read does.
      const [only] = slides.items;
      let slideShapes: PowerPointShapeOut[] | null = null;
      if (
        hasFileRoute(support) &&
        slides.items.length === 1 &&
        fileCouldFill(selected)
      ) {
        const onSlide = only.shapes.load(shapeLoadPaths(support));
        await context.sync();
        slideShapes = await readShapeContent(context, onSlide.items, support);
      }
      return {
        slideCount: all.items.length,
        slides: slides.items.map((slide) => ({
          id: slide.id,
          position: order.get(slide.id),
        })),
        text,
        shapes: selected,
        slideShapes,
      };
    });
    const selection = selectedSlideList(live.slides);
    const [onlySlide] = live.slides;
    const outcome =
      live.slideShapes && onlySlide.position !== undefined
        ? await withFileContent(
            support,
            {
              id: onlySlide.id,
              position: onlySlide.position,
              slideCount: live.slideCount,
            },
            live.slideShapes,
            live.shapes,
            deadline,
          )
        : null;
    const { text } = live;
    const result: Record<string, unknown> = {
      ...envelope(support),
      ...(outcome?.ok && !outcome.current
        ? { fileContent: SAVED_FILE_NOTE }
        : {}),
      selectedSlides: selection.listed,
      ...("selectedSlideCount" in selection
        ? { selectedSlideCount: selection.selectedSlideCount }
        : {}),
      ...(!failed(text) && typeof text === "string" && text
        ? { selectedText: capText(normalizePowerPointText(text), 2000) }
        : {}),
    };
    // The selected text and slide list share the page, so a shape gets what is left.
    const room = POWERPOINT_READ_MAX_BYTES - jsonBytes(result) - 600;
    const selectedShapes: PowerPointShapeOut[] = live.shapes.map((shape) =>
      capShape(shape, room),
    );
    const { taken } = fitItems(result, "selectedShapes", selectedShapes);
    if (taken < selectedShapes.length)
      result.truncated = `${selectedShapes.length - taken} more selected shapes were left out to keep this result small; read their slide instead.`;
    return { ok: true, result };
  });
}
