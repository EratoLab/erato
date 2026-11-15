import {
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

const MAX_NOTES_CHARACTERS = 4000;

export const hasFileRoute = (support: PowerPointReadSupport) =>
  support.slideExport || support.presentationFile;

export interface PowerPointSlideRef {
  /** Office.js slide id, e.g. "256#3077428485": the number before "#" is p:sldId/@id. */
  id: string;
  /** 1-based, from Office.js. */
  position: number;
  slideCount: number;
}

export type FileSlideOutcome =
  | { ok: true; slide: PptxSlide }
  | { ok: false; reason: string };

const STALE =
  "the presentation file PowerPoint handed over does not match the slide on screen (changes not saved yet, or made during the read); try again after saving";

class StaleFileError extends Error {}

/**
 * The slide from a file. Full tier: the one-slide export, unless it leaves out a part the slide
 * refers to; then the whole file. Basic tier: the whole file. Nothing is cached between calls:
 * PowerPoint reports no edits to an add-in, so a cached copy could not tell when it went stale.
 */
export async function readFileSlide(
  support: PowerPointReadSupport,
  ref: PowerPointSlideRef,
): Promise<FileSlideOutcome> {
  let exportProblem: string | null = null;
  if (support.slideExport) {
    try {
      const read = await withExportedSlide(ref.id, async (zip) => {
        const list = await readPptxSlideList(zip);
        if (list.length !== 1)
          throw new PowerPointFileError(
            "failed",
            `the slide export holds ${list.length} slides`,
          );
        const missing = await missingSlideParts(zip, list[0].part);
        if (missing.length > 0) return { missing, slide: null };
        return { missing, slide: await readPptxSlide(zip, list[0].part) };
      });
      if (read.slide) return { ok: true, slide: read.slide };
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
  try {
    const slide = await withPresentationFile(async (zip) => {
      const list = await readPptxSlideList(zip);
      const entry = list[ref.position - 1];
      const sldId = /^(\d+)(?:#|$)/.exec(ref.id)?.[1];
      if (
        list.length !== ref.slideCount ||
        !entry ||
        (sldId !== undefined && entry.sldId !== sldId)
      )
        throw new StaleFileError();
      return readPptxSlide(zip, entry.part);
    });
    return { ok: true, slide };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof StaleFileError ? STALE : powerpointFileFailure(error),
    };
  }
}

const CUT_MARK = /…\[cut: \d+ more characters\]$/;
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
 * Whether the file shows the slide as it is on screen: every live shape is in the file, and every
 * text the live read got is the file's text. getFileAsync may hand over the last saved state, and
 * the slide can change between the two reads; content from such a file is not returned.
 */
export function fileMatchesLive(
  live: readonly PowerPointShapeOut[],
  file: PptxSlide,
): boolean {
  const byId = pptxShapesById(file.shapes);
  const matches = (shape: PowerPointShapeOut): boolean => {
    const saved = byId.get(shape.id);
    if (!saved) return false;
    const seen = liveText(shape);
    if (seen && !saved.hasField) {
      const a = comparable(seen.text);
      const b = comparable(saved.text ?? "");
      if (seen.cut ? !b.startsWith(a) : a !== b) return false;
    }
    return (shape.children ?? []).every(matches);
  };
  return live.every(matches);
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
  const opaque = OPAQUE_CONTENT[saved.type];
  if (opaque && opaque !== CHART_UNREAD && opaque !== SMART_ART_UNREAD)
    addNotes(out, [opaque]);
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
  const byId = pptxShapesById(file.shapes);
  const fill = (out: PowerPointShapeOut, depth: number) => {
    const saved = byId.get(out.id);
    if (saved) {
      const placeholderOther = dropNote(out, PLACEHOLDER_OTHER_UNREAD);
      if (placeholderOther && saved.type !== "Placeholder")
        out.holds = saved.type;
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
      if (saved.type === "Image" && placeholderOther)
        addNotes(out, [OPAQUE_CONTENT.Image]);
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

/** The file could not be used: the notes that said "no API reads it" now say why. */
export function markFileUnread(live: PowerPointShapeOut[], reason: string) {
  const mark = (out: PowerPointShapeOut) => {
    if (dropNote(out, CHART_UNREAD)) addNotes(out, [`chart data: ${reason}`]);
    if (dropNote(out, SMART_ART_UNREAD))
      addNotes(out, [`SmartArt text: ${reason}`]);
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

/** Speaker notes and the hidden flag for a slide result, or why they are missing. */
export function slideFileFields(outcome: FileSlideOutcome) {
  if (!outcome.ok)
    return {
      unread: [
        `speaker notes and whether the slide is hidden: ${outcome.reason}`,
      ],
    };
  return {
    hidden: outcome.slide.hidden,
    notes: capText(outcome.slide.notes, MAX_NOTES_CHARACTERS),
  };
}

/** Reads the slide's file and merges it into `live`; on any failure `live` keeps its unread notes. */
export async function withFileContent(
  support: PowerPointReadSupport,
  ref: PowerPointSlideRef,
  live: PowerPointShapeOut[],
): Promise<FileSlideOutcome> {
  let outcome = await readFileSlide(support, ref);
  if (outcome.ok && !fileMatchesLive(live, outcome.slide))
    outcome = { ok: false, reason: STALE };
  if (outcome.ok) applyFileSlide(live, outcome.slide, support);
  else markFileUnread(live, outcome.reason);
  return outcome;
}
