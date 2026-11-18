import {
  POWERPOINT_FILE_LIMITS,
  PowerPointFileError,
  powerpointFileFailure,
  withExportedSlide,
  withPresentationFile,
} from "./powerpointFile";
import {
  missingSlideParts,
  pptxShapesById,
  readPptxSlide,
  readPptxSlideList,
} from "./powerpointPackage";
import { PowerPointTimeoutError } from "./powerpointRun";
import {
  CHART_UNREAD,
  CUT_MARK,
  MAX_GROUP_DEPTH,
  OPAQUE_CONTENT,
  PLACEHOLDER_OTHER_UNREAD,
  SMART_ART_UNREAD,
  TEXT_TYPES,
  UNDESCRIBED_UNREAD,
  capTable,
  capText,
  hostCannot,
  readingOrder,
} from "./powerpointShapeRead";

import type { PptxShape, PptxSlide } from "./powerpointPackage";
import type { PowerPointReadSupport } from "./powerpointReadSupport";
import type { PowerPointShapeOut } from "./powerpointShapeRead";

/** What a slide read adds from the file, in the model's words. */
export const POWERPOINT_FILE_CONTENT = [
  "speaker notes",
  "chart data",
  "SmartArt text",
  "whether a slide is hidden",
];

const MAX_NOTES_BYTES = 4000;

export const hasFileRoute = (support: PowerPointReadSupport) =>
  support.slideExport || support.presentationFile;

export interface PowerPointSlideRef {
  /** Office.js slide id, e.g. "256#3077428485": the number before "#" is p:sldId/@id. */
  id: string;
  /** 1-based, from Office.js. */
  position: number;
  slideCount: number;
}

/**
 * "export": `slide.exportAsBase64()`, which PowerPoint builds from the open slide when asked, like
 * every other Office.js read, so it is taken as current. "file": `getFileAsync`, current where
 * `fileIsCurrent` says so; elsewhere it may be the last saved state and is labelled as such.
 */
export type FileRoute = "export" | "file";

export type FileSlideOutcome =
  | {
      ok: true;
      slide: PptxSlide;
      route: FileRoute;
      current: boolean;
      /** False for an export without a notes page where `exportKeepsNotes` is not measured. */
      notesKnown: boolean;
    }
  | { ok: false; reason: string };

const MISMATCH = {
  export:
    "PowerPoint's slide export does not match the slide on screen (the slide changed during the read, or it holds content this reader cannot compare)",
  currentFile:
    "the presentation file PowerPoint handed over does not match the slide on screen (the slide changed during the read, or it holds content this reader cannot compare)",
  savedFile:
    "the presentation file PowerPoint handed over does not match the slide on screen (changes not saved yet, or made during the read); try again after saving",
};
const mismatchReason = (route: FileRoute, current: boolean) =>
  route === "export"
    ? MISMATCH.export
    : current
      ? MISMATCH.currentFile
      : MISMATCH.savedFile;
const UNMODELED =
  "the slide holds a kind of shape this reader cannot match to the file";

/** How the model should take content that came from the whole file. */
export const SAVED_FILE_NOTE =
  "Speaker notes, chart data, SmartArt text, the hidden flag, and tables and shapes inside groups that only the file supplied, come from the presentation file as PowerPoint handed it over. That may be the last saved version, so unsaved changes to them can be missing: call them the version last saved.";

class FileMismatchError extends Error {}

/**
 * The slide from a file. Full tier: the one-slide export, unless it leaves out a part the slide
 * refers to; then the whole file. Basic tier: the whole file. Nothing is cached between calls:
 * PowerPoint reports no edits to an add-in, so a cached copy could not tell when it went stale.
 */
export async function readFileSlide(
  support: PowerPointReadSupport,
  ref: PowerPointSlideRef,
  deadline: number,
): Promise<FileSlideOutcome> {
  let exportProblem: string | null = null;
  if (support.slideExport) {
    try {
      const read = await withExportedSlide(ref.id, deadline, async (zip) => {
        const list = await readPptxSlideList(zip);
        if (list.length !== 1)
          throw new PowerPointFileError(
            `the slide export holds ${list.length} slides`,
          );
        const missing = await missingSlideParts(zip, list[0].part);
        if (missing.length > 0) return { missing, slide: null };
        return { missing, slide: await readPptxSlide(zip, list[0].part) };
      });
      if (read.slide)
        return {
          ok: true,
          slide: read.slide,
          route: "export",
          current: true,
          notesKnown: read.slide.hasNotesPage || support.exportKeepsNotes,
        };
      exportProblem = `the slide export left out ${read.missing.join(", ")}`;
    } catch (error) {
      exportProblem = powerpointFileFailure(error);
      // A slow export leaves no time for the slower whole file in the same tool call.
      if (error instanceof PowerPointTimeoutError)
        return { ok: false, reason: exportProblem };
    }
  }
  if (!support.presentationFile)
    return {
      ok: false,
      reason:
        exportProblem ??
        "this PowerPoint does not hand over the presentation file",
    };
  const both = (reason: string) =>
    exportProblem ? `${reason}; before that, ${exportProblem}` : reason;
  if (
    Date.now() + POWERPOINT_FILE_LIMITS.minWholeFileMs > deadline &&
    exportProblem
  )
    return {
      ok: false,
      reason: both("no time was left to read the whole file"),
    };
  try {
    const slide = await withPresentationFile(deadline, async (zip) => {
      const list = await readPptxSlideList(zip);
      const entry = list[ref.position - 1];
      const sldId = /^(\d+)(?:#|$)/.exec(ref.id)?.[1];
      if (
        list.length !== ref.slideCount ||
        !entry ||
        (sldId !== undefined && entry.sldId !== sldId)
      )
        throw new FileMismatchError();
      return readPptxSlide(zip, entry.part);
    });
    return {
      ok: true,
      slide,
      route: "file",
      current: support.fileIsCurrent,
      notesKnown: true,
    };
  } catch (error) {
    return {
      ok: false,
      reason: both(
        error instanceof FileMismatchError
          ? mismatchReason("file", support.fileIsCurrent)
          : powerpointFileFailure(error),
      ),
    };
  }
}

const comparable = (text: string) => text.replace(/\s+/g, " ").trim();

function liveText(
  shape: PowerPointShapeOut,
): { text: string; cut: boolean } | null {
  if (shape.paragraphs)
    return {
      text: shape.paragraphs
        .map((p) => p.text.replace(CUT_MARK, ""))
        .join("\n"),
      cut:
        shape.paragraphs.some((p) => CUT_MARK.test(p.text)) ||
        !!shape.unread?.some((note) => note.startsWith("paragraphs ")),
    };
  if (shape.text === undefined) return null;
  return {
    text: shape.text.replace(CUT_MARK, ""),
    cut: CUT_MARK.test(shape.text),
  };
}

/**
 * Why the file does not show the slide as it is on screen, or null when it does: every live shape
 * must be in the file, and every text the live read got must be the file's text. A shape whose id
 * the file holds twice is not compared.
 */
export function fileMismatch(
  live: readonly PowerPointShapeOut[],
  file: PptxSlide,
  route: FileRoute,
  current: boolean,
): string | null {
  const { byId, duplicates } = pptxShapesById(file.shapes);
  let missing = false;
  const matches = (shape: PowerPointShapeOut): boolean => {
    if (duplicates.has(shape.id)) return true;
    const saved = byId.get(shape.id);
    if (!saved) {
      missing = true;
      return false;
    }
    const seen = liveText(shape);
    if (seen && !saved.hasField) {
      const a = comparable(seen.text);
      const b = comparable(saved.text ?? "");
      if (seen.cut ? !b.startsWith(a) : a !== b) return false;
    }
    return (shape.children ?? []).every(matches);
  };
  if (live.every(matches)) return null;
  // A shape the reader cannot model is not evidence of unsaved changes.
  return missing && file.unmodeled > 0
    ? UNMODELED
    : mismatchReason(route, current);
}

function dropNote(out: PowerPointShapeOut, note: string): boolean {
  const before = out.unread?.length ?? 0;
  out.unread = out.unread?.filter((n) => n !== note);
  if (out.unread?.length === 0) delete out.unread;
  return (out.unread?.length ?? 0) < before;
}

function addNotes(
  out: PowerPointShapeOut,
  notes: readonly string[] | undefined,
) {
  if (notes?.length) out.unread = [...(out.unread ?? []), ...notes];
}

function tableOut(table: NonNullable<PptxShape["table"]>) {
  const values = capTable(table.values);
  return {
    out: { rows: table.rows, columns: table.columns, values },
    cut:
      values.length < table.values.length
        ? `table rows ${values.length + 1}-${table.values.length}: cut to keep the result small`
        : null,
  };
}

const contentNote = (type: string) =>
  OPAQUE_CONTENT[type] ?? (type === "Unsupported" ? UNDESCRIBED_UNREAD : null);

/** A shape only the file describes: a group child where this host cannot read groups. */
function shapeFromFile(saved: PptxShape, depth: number): PowerPointShapeOut {
  const out: PowerPointShapeOut = {
    id: saved.id,
    name: saved.name,
    type: saved.type,
    box: saved.box ?? { left: 0, top: 0, width: 0, height: 0 },
  };
  if (!saved.box) addNotes(out, ["position: not saved in the file"]);
  if (saved.text) out.text = capText(saved.text);
  if (saved.table) {
    const { out: table, cut } = tableOut(saved.table);
    out.table = table;
    if (cut) addNotes(out, [cut]);
  }
  if (saved.chart) out.chart = saved.chart;
  if (saved.smartArt) out.smartArt = saved.smartArt;
  addNotes(out, saved.unread);
  const note = contentNote(saved.type);
  if (note && note !== CHART_UNREAD && note !== SMART_ART_UNREAD)
    addNotes(out, [note]);
  if (saved.children) {
    if (depth + 1 >= MAX_GROUP_DEPTH)
      addNotes(out, ["group children: nested too deep to read"]);
    else
      out.children = readingOrder(
        saved.children.map((c) => shapeFromFile(c, depth + 1)),
      );
  }
  return out;
}

/** Fills what the live read marked unread and the file has. Mutates `live`. */
export function applyFileSlide(
  live: PowerPointShapeOut[],
  file: PptxSlide,
  support: PowerPointReadSupport,
) {
  const { byId, duplicates } = pptxShapesById(file.shapes);
  const fill = (out: PowerPointShapeOut, depth: number) => {
    const saved = byId.get(out.id);
    if (duplicates.has(out.id))
      addNotes(out, [
        "content from the file: the file has two shapes with this id",
      ]);
    if (saved) {
      const placeholderOther = dropNote(out, PLACEHOLDER_OTHER_UNREAD);
      if (placeholderOther) {
        if (saved.type !== "Placeholder") out.holds = saved.type;
        else if (saved.text && out.text === undefined)
          out.text = capText(saved.text);
        // What the placeholder holds and no reader can open, e.g. an embedded object.
        const note = contentNote(saved.type);
        if (note && note !== CHART_UNREAD && note !== SMART_ART_UNREAD)
          addNotes(out, [note]);
      }
      if (
        saved.type === "Chart" &&
        (dropNote(out, CHART_UNREAD) || placeholderOther)
      ) {
        if (saved.chart) out.chart = saved.chart;
        addNotes(out, saved.unread);
      }
      if (
        saved.type === "SmartArt" &&
        (dropNote(out, SMART_ART_UNREAD) || placeholderOther)
      ) {
        if (saved.smartArt) out.smartArt = saved.smartArt;
        addNotes(out, saved.unread);
      }
      if (
        saved.table &&
        !out.table &&
        (dropNote(out, hostCannot("tables")) || placeholderOther)
      ) {
        const { out: table, cut } = tableOut(saved.table);
        out.table = table;
        if (cut) addNotes(out, [cut]);
      }
      if (
        saved.children &&
        !out.children &&
        dropNote(out, hostCannot("groups"))
      ) {
        if (depth + 1 >= MAX_GROUP_DEPTH)
          addNotes(out, ["group children: nested too deep to read"]);
        else
          out.children = readingOrder(
            saved.children.map((c) => shapeFromFile(c, depth + 1)),
          );
      }
      const neverAsked = support.tier !== "full" && !TEXT_TYPES.has(out.type);
      if (
        saved.text &&
        out.text === undefined &&
        !out.paragraphs &&
        (dropNote(out, UNDESCRIBED_UNREAD) || neverAsked)
      )
        out.text = capText(saved.text);
    }
    for (const child of out.children ?? []) fill(child, depth + 1);
  };
  for (const out of live) fill(out, 0);
}

/** The file could not be used: notes that pointed at the API's limits now say why. */
export function markFileUnread(
  live: PowerPointShapeOut[],
  reason: string,
  support: PowerPointReadSupport,
) {
  const replacements: [string, string][] = [
    [CHART_UNREAD, "chart data"],
    [SMART_ART_UNREAD, "SmartArt text"],
    ...(support.presentationFile
      ? ([
          [hostCannot("tables"), "table contents"],
          [hostCannot("groups"), "shapes inside groups"],
        ] as [string, string][])
      : []),
  ];
  const mark = (out: PowerPointShapeOut) => {
    for (const [note, what] of replacements)
      if (dropNote(out, note)) addNotes(out, [`${what}: ${reason}`]);
    for (const child of out.children ?? []) mark(child);
  };
  live.forEach(mark);
}

/** Whether the file could fill anything the live read left unread in these shapes. */
export function fileCouldFill(live: readonly PowerPointShapeOut[]): boolean {
  const fillable = new Set([
    CHART_UNREAD,
    SMART_ART_UNREAD,
    PLACEHOLDER_OTHER_UNREAD,
    UNDESCRIBED_UNREAD,
    hostCannot("tables"),
    hostCannot("groups"),
  ]);
  const check = (out: PowerPointShapeOut): boolean =>
    !!out.unread?.some((note) => fillable.has(note)) ||
    (out.children ?? []).some(check);
  return live.some(check);
}

const encoder = new TextEncoder();

/** The longest prefix of `text` within `maxBytes` of UTF-8, with a cut marker. */
export function capTextBytes(text: string, maxBytes: number): string {
  if (encoder.encode(text).length <= maxBytes) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (encoder.encode(text.slice(0, mid)).length <= maxBytes - 40) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low)}…[cut: ${text.length - low} more characters]`;
}

/**
 * Speaker notes, the hidden flag and the source label for a slide result, or why they are
 * missing. Notes go on the first page only; continuation pages refer back to it.
 */
export function slideFileFields(outcome: FileSlideOutcome, firstPage: boolean) {
  if (!outcome.ok)
    return {
      unread: [
        `speaker notes and whether the slide is hidden: ${outcome.reason}`,
      ],
    };
  const { slide, current, notesKnown } = outcome;
  return {
    hidden: slide.hidden,
    ...(!firstPage
      ? { notesOnFirstPage: true }
      : notesKnown
        ? { notes: capTextBytes(slide.notes, MAX_NOTES_BYTES) }
        : {
            unread: [
              "speaker notes: PowerPoint's slide export holds none; whether the export keeps notes on this platform is not verified yet, so the slide may still have some",
            ],
          }),
    ...(current ? {} : { fileContent: SAVED_FILE_NOTE }),
  };
}

/**
 * Reads the slide's file, checks it against `check` (the slide's live shapes) and fills `target`
 * (the shapes the result returns: the slide's, or the selected ones). On any failure `target`
 * keeps its unread notes with the reason.
 */
export async function withFileContent(
  support: PowerPointReadSupport,
  ref: PowerPointSlideRef,
  check: readonly PowerPointShapeOut[],
  target: PowerPointShapeOut[],
  deadline: number,
): Promise<FileSlideOutcome> {
  let outcome = await readFileSlide(support, ref, deadline);
  if (outcome.ok) {
    const mismatch = fileMismatch(
      check,
      outcome.slide,
      outcome.route,
      outcome.current,
    );
    if (mismatch) outcome = { ok: false, reason: mismatch };
  }
  if (outcome.ok) applyFileSlide(target, outcome.slide, support);
  else markFileUnread(target, outcome.reason, support);
  return outcome;
}
