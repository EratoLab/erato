import {
  isWordMediaElementActive,
  wordMediaMutationContainer,
} from "./wordMediaComparison";
import {
  allocateWordNativeId,
  compileWordDrawing,
  compileWordImage,
  inventoryWordMedia,
  isWordDrawingSpec,
  isWordImageSpec,
} from "./wordMediaContent";

import type {
  WordDrawingSpec,
  WordImageSpec,
  WordMediaSource,
} from "./wordMediaContent";

export interface WordFieldSpec {
  instruction: string;
  text: string;
  locked?: boolean;
}
export interface WordBookmarkSpec<T = unknown> {
  name: string;
  children: T[];
}
export interface WordContentControlSpec<T = unknown> {
  title?: string;
  tag?: string;
  lock?: "none" | "content" | "control" | "both";
  appearance?: "bounding-box" | "tags" | "hidden";
  color?: string;
  children: T[];
}

type Mutation = "update" | "unwrap" | "delete";
export type WordNativeStructureEdit<T = unknown> =
  | {
      kind: "field";
      target: string;
      operation: Mutation;
      instruction?: string;
      text?: string;
      locked?: boolean;
    }
  | {
      kind: "bookmark";
      target: string;
      operation: Mutation;
      name?: string;
      text?: string;
    }
  | {
      kind: "content-control";
      target: string;
      operation: Mutation;
      title?: string;
      tag?: string;
      lock?: WordContentControlSpec["lock"];
      appearance?: WordContentControlSpec["appearance"];
      color?: string;
      children?: T[];
      binding?: "retain" | "remove";
    }
  | {
      kind: "image";
      target: string;
      operation: "update" | "delete";
      image?: WordImageSpec;
    }
  | {
      kind: "drawing";
      target: string;
      operation: "update" | "delete";
      drawing?: WordDrawingSpec;
    };

export interface WordNativeStructureObject {
  kind: "field" | "bookmark" | "content-control";
  target: string;
  instruction?: string;
  text?: string;
  name?: string;
  id?: string;
  title?: string;
  tag?: string;
  lock?: WordContentControlSpec["lock"];
  bound?: boolean;
}

export interface WordNativeStructureOptions<T> extends WordMediaSource {
  compileBlocks: (blocks: T[]) => Element[];
  resolveMediaSource?: (
    ref: string,
  ) => WordMediaSource & { sourceIndex?: number };
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
const XML = "http://www.w3.org/XML/1998/namespace";
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).every((k) => allowed.includes(k));
const text = (v: unknown, max = 32000): v is string =>
  typeof v === "string" &&
  v.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const bookmarkName = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(v);
const optionalControl = (v: Record<string, unknown>) =>
  [v.title, v.tag].every((s) => s === undefined || text(s, 255)) &&
  (v.lock === undefined ||
    ["none", "content", "control", "both"].includes(v.lock as string)) &&
  (v.appearance === undefined ||
    ["bounding-box", "tags", "hidden"].includes(v.appearance as string)) &&
  (v.color === undefined ||
    (typeof v.color === "string" && /^[a-fA-F\d]{6}$/.test(v.color)));
/** Do not create fields that execute commands or acquire external resources on update. */
export function isWordFieldInstruction(value: unknown): value is string {
  return (
    text(value, 4000) &&
    !/[\r\n{}]/.test(value) &&
    /^(?:=|ADDRESSBLOCK\b|ADVANCE\b|ASK\b|AUTHOR\b|AUTONUM\b|AUTONUMLGL\b|AUTONUMOUT\b|BARCODE\b|BIDIOUTLINE\b|COMMENTS\b|COMPARE\b|CREATEDATE\b|DATE\b|DOCPROPERTY\b|DOCVARIABLE\b|EDITTIME\b|EQ\b|FILENAME\b|FILESIZE\b|FILLIN\b|FORMCHECKBOX\b|FORMDROPDOWN\b|FORMTEXT\b|GOTOBUTTON\b|GREETINGLINE\b|IF\b|INDEX\b|INFO\b|KEYWORDS\b|LASTSAVEDBY\b|LISTNUM\b|MACROBUTTON\b|MERGEFIELD\b|MERGEREC\b|MERGESEQ\b|NEXT\b|NEXTIF\b|NOTEREF\b|NUMCHARS\b|NUMPAGES\b|NUMWORDS\b|PAGE\b|PAGEREF\b|PRINTDATE\b|PRIVATE\b|QUOTE\b|REF\b|REVNUM\b|SAVEDATE\b|SECTION\b|SECTIONPAGES\b|SEQ\b|SET\b|SKIPIF\b|STYLEREF\b|SUBJECT\b|SYMBOL\b|TA\b|TC\b|TEMPLATE\b|TIME\b|TITLE\b|TOA\b|TOC\b|USERADDRESS\b|USERINITIALS\b|USERNAME\b|XE\b)/i.test(
      value.trim(),
    ) &&
    !/^MACROBUTTON\b/i.test(value.trim())
  );
}
export function isWordFieldSpec(v: unknown): v is WordFieldSpec {
  return (
    record(v) &&
    keys(v, ["instruction", "text", "locked"]) &&
    isWordFieldInstruction(v.instruction) &&
    text(v.text) &&
    (v.locked === undefined || typeof v.locked === "boolean")
  );
}
export function isWordBookmarkSpec<T>(
  v: unknown,
  validBlock: (b: unknown) => boolean,
): v is WordBookmarkSpec<T> {
  return (
    record(v) &&
    keys(v, ["name", "children"]) &&
    bookmarkName(v.name) &&
    Array.isArray(v.children) &&
    v.children.length > 0 &&
    v.children.length <= 2000 &&
    v.children.every(validBlock)
  );
}
export function isWordContentControlSpec<T>(
  v: unknown,
  validBlock: (b: unknown) => boolean,
): v is WordContentControlSpec<T> {
  return (
    record(v) &&
    keys(v, ["title", "tag", "lock", "appearance", "color", "children"]) &&
    optionalControl(v) &&
    Array.isArray(v.children) &&
    v.children.length <= 2000 &&
    v.children.every(validBlock)
  );
}
export function isWordNativeStructureEdit<T>(
  v: unknown,
  validBlock: (b: unknown) => boolean,
): v is WordNativeStructureEdit<T> {
  if (
    !record(v) ||
    typeof v.target !== "string" ||
    !/^(?:field|bookmark|control|image|drawing)-[1-9]\d{0,3}$/.test(v.target) ||
    !["update", "unwrap", "delete"].includes(v.operation as string)
  )
    return false;
  if (v.kind === "image" || v.kind === "drawing") {
    const name = v.kind;
    return (
      keys(v, ["kind", "target", "operation", name]) &&
      v.target.startsWith(`${name}-`) &&
      v.operation !== "unwrap" &&
      (v.operation === "delete"
        ? v[name] === undefined
        : name === "image"
          ? record(v.image) &&
            isWordImageSpec({ sourceRef: "source", ...v.image })
          : record(v.drawing) &&
            isWordDrawingSpec({ sourceRef: "source", ...v.drawing }))
    );
  }
  if (v.kind === "field")
    return (
      keys(v, [
        "kind",
        "target",
        "operation",
        "instruction",
        "text",
        "locked",
      ]) &&
      v.target.startsWith("field-") &&
      (v.instruction === undefined || isWordFieldInstruction(v.instruction)) &&
      (v.text === undefined || text(v.text)) &&
      (v.locked === undefined || typeof v.locked === "boolean") &&
      (v.operation === "update" ||
        [v.instruction, v.text, v.locked].every((x) => x === undefined))
    );
  if (v.kind === "bookmark")
    return (
      keys(v, ["kind", "target", "operation", "name", "text"]) &&
      v.target.startsWith("bookmark-") &&
      (v.name === undefined || bookmarkName(v.name)) &&
      (v.text === undefined || text(v.text)) &&
      (v.operation === "update" ||
        [v.name, v.text].every((x) => x === undefined))
    );
  return (
    v.kind === "content-control" &&
    keys(v, [
      "kind",
      "target",
      "operation",
      "title",
      "tag",
      "lock",
      "appearance",
      "color",
      "children",
      "binding",
    ]) &&
    v.target.startsWith("control-") &&
    optionalControl(v) &&
    (v.binding === undefined ||
      ["retain", "remove"].includes(v.binding as string)) &&
    (v.children === undefined ||
      (Array.isArray(v.children) &&
        v.children.length <= 2000 &&
        v.children.every(validBlock))) &&
    (v.operation === "update" ||
      [
        v.title,
        v.tag,
        v.lock,
        v.appearance,
        v.color,
        v.children,
        v.binding,
      ].every((x) => x === undefined))
  );
}

const all = (node: Element | Document, name: string) =>
  Array.from(node.getElementsByTagNameNS(W, name)).filter(
    isWordMediaElementActive,
  );
const child = (node: Element, name: string) =>
  Array.from(node.children).find(
    (c) => c.namespaceURI === W && c.localName === name,
  );
const attr = (node: Element | undefined, name = "val") =>
  node?.getAttributeNS(W, name) ?? "";
const make = (doc: Document, name: string, value?: string) => {
  const node = doc.createElementNS(W, `w:${name}`);
  if (value !== undefined) node.setAttributeNS(W, "w:val", value);
  return node;
};
function run(doc: Document, value: string) {
  const r = make(doc, "r");
  value.split(/([\t\n\r])/).forEach((part) => {
    if (part === "\r") return;
    if (part === "\t" || part === "\n")
      r.append(make(doc, part === "\t" ? "tab" : "br"));
    else {
      const t = make(doc, "t");
      t.setAttributeNS(XML, "xml:space", "preserve");
      t.textContent = part;
      r.append(t);
    }
  });
  return r;
}
const contentText = (node: Element) =>
  all(node, "t")
    .map((t) => t.textContent ?? "")
    .join("");
function controlProperties(
  doc: Document,
  properties: Element,
  spec: Omit<WordContentControlSpec, "children">,
) {
  for (const [key, local] of [
    ["title", "alias"],
    ["tag", "tag"],
  ] as const)
    if (spec[key] !== undefined) {
      child(properties, local)?.remove();
      properties.append(make(doc, local, spec[key]));
    }
  if (spec.lock !== undefined) {
    child(properties, "lock")?.remove();
    if (spec.lock !== "none")
      properties.append(
        make(
          doc,
          "lock",
          {
            content: "contentLocked",
            control: "sdtLocked",
            both: "sdtContentLocked",
          }[spec.lock],
        ),
      );
  }
  if (spec.appearance !== undefined) {
    for (const e of Array.from(
      properties.getElementsByTagNameNS(W15, "appearance"),
    ))
      e.remove();
    const e = doc.createElementNS(W15, "w15:appearance");
    e.setAttributeNS(
      W15,
      "w15:val",
      { "bounding-box": "boundingBox", tags: "tags", hidden: "hidden" }[
        spec.appearance
      ],
    );
    properties.append(e);
  }
  if (spec.color !== undefined) {
    for (const e of Array.from(properties.getElementsByTagNameNS(W15, "color")))
      e.remove();
    const e = doc.createElementNS(W15, "w15:color");
    e.setAttributeNS(W, "w:val", spec.color.toUpperCase());
    properties.append(e);
  }
}

export function compileWordField(doc: Document, spec: WordFieldSpec): Element {
  if (!isWordFieldSpec(spec)) throw new Error("Invalid field specification");
  const p = make(doc, "p");
  p.append(
    ...fieldRuns(
      doc,
      spec.instruction.trim(),
      [run(doc, spec.text)],
      spec.locked ? "1" : undefined,
    ),
  );
  return p;
}

function fieldRuns(
  doc: Document,
  instruction: string,
  result: Node[],
  locked?: string,
  dirty?: string,
): Element[] {
  const marker = (type: string) => {
    const r = make(doc, "r"),
      field = make(doc, "fldChar");
    field.setAttributeNS(W, "w:fldCharType", type);
    r.append(field);
    return r;
  };
  const begin = marker("begin");
  if (locked !== undefined)
    begin.firstElementChild!.setAttributeNS(W, "w:fldLock", locked);
  if (dirty !== undefined)
    begin.firstElementChild!.setAttributeNS(W, "w:dirty", dirty);
  const codeRun = make(doc, "r"),
    code = make(doc, "instrText");
  if (/^\s|\s$/.test(instruction))
    code.setAttributeNS(XML, "xml:space", "preserve");
  code.textContent = instruction;
  codeRun.append(code);
  return [
    begin,
    codeRun,
    marker("separate"),
    ...result.filter((n): n is Element => n.nodeType === 1),
    marker("end"),
  ];
}

export function compileWordBookmark<T>(
  doc: Document,
  spec: WordBookmarkSpec<T>,
  compileBlocks: (blocks: T[]) => Element[],
): Element[] {
  if (!bookmarkName(spec.name)) throw new Error("Invalid bookmark name");
  if (all(doc, "bookmarkStart").some((b) => attr(b, "name") === spec.name))
    throw new Error("Duplicate bookmark name");
  const blocks = compileBlocks(spec.children);
  if (!blocks.length) blocks.push(make(doc, "p"));
  const id = allocateWordNativeId(doc, "bookmark");
  const start = make(doc, "bookmarkStart"),
    end = make(doc, "bookmarkEnd");
  start.setAttributeNS(W, "w:id", id);
  start.setAttributeNS(W, "w:name", spec.name);
  end.setAttributeNS(W, "w:id", id);
  const first = blocks[0],
    last = blocks.at(-1)!;
  const firstParagraph =
    first.localName === "p" && first.namespaceURI === W
      ? first
      : all(first, "p")[0];
  const lastParagraph =
    last.localName === "p" && last.namespaceURI === W
      ? last
      : all(last, "p").at(-1);
  if (!firstParagraph || !lastParagraph)
    throw new Error("Bookmarks need paragraph anchors");
  firstParagraph.insertBefore(
    start,
    child(firstParagraph, "pPr")?.nextSibling ?? firstParagraph.firstChild,
  );
  lastParagraph.append(end);
  return blocks;
}

export function compileWordContentControl<T>(
  doc: Document,
  spec: WordContentControlSpec<T>,
  compileBlocks: (blocks: T[]) => Element[],
): Element {
  if (!optionalControl(spec as unknown as Record<string, unknown>))
    throw new Error("Invalid content control specification");
  const control = make(doc, "sdt"),
    properties = make(doc, "sdtPr"),
    contents = make(doc, "sdtContent");
  properties.append(make(doc, "id", allocateWordNativeId(doc, "control")));
  controlProperties(doc, properties, spec);
  const id = child(properties, "id")!;
  properties.insertBefore(
    id,
    Array.from(properties.children).find((e) => e.namespaceURI !== W) ?? null,
  );
  const blocks = compileBlocks(spec.children);
  contents.append(...(blocks.length ? blocks : [make(doc, "p")]));
  control.append(properties, contents);
  return control;
}

/** The representations below are equivalent in Word. This function changes a
 * comparison clone only; field instructions/results and control values remain. */
export function normalizeWordInlineForComparison(doc: Document): void {
  const XMLNS = "http://www.w3.org/2000/xmlns/";
  for (const field of all(doc, "fldSimple")) {
    if (
      !field.hasAttributeNS(W, "instr") ||
      Array.from(field.childNodes).some(
        (node) =>
          node.nodeType !== 1 &&
          !(node.nodeType === 3 && !node.textContent?.trim()),
      ) ||
      Array.from(field.attributes).some(
        (a) =>
          a.namespaceURI !== XMLNS &&
          !(
            a.namespaceURI === W &&
            ["instr", "fldLock", "dirty"].includes(a.localName)
          ),
      )
    )
      continue;
    field.replaceWith(
      ...fieldRuns(
        doc,
        attr(field, "instr"),
        Array.from(field.childNodes),
        field.hasAttributeNS(W, "fldLock") ? attr(field, "fldLock") : undefined,
        field.hasAttributeNS(W, "dirty") ? attr(field, "dirty") : undefined,
      ),
    );
  }
  // Word serializes field code/markers as distinct runs even when an edit was
  // made inside a single run. Retain run attributes/properties when splitting.
  for (const r of all(doc, "r")) {
    const children = Array.from(r.children).filter(
      (e) => !(e.namespaceURI === W && e.localName === "rPr"),
    );
    if (
      children.length < 2 ||
      !children.some(
        (e) =>
          e.namespaceURI === W &&
          ["fldChar", "instrText"].includes(e.localName),
      )
    )
      continue;
    const properties = child(r, "rPr");
    const runs = children.map((element) => {
      const next = r.cloneNode(false) as Element;
      if (properties) next.append(properties.cloneNode(true));
      next.append(element);
      return next;
    });
    r.replaceWith(...runs);
  }
  for (const marker of all(doc, "fldChar")) {
    for (const name of ["fldLock", "dirty"]) {
      const value = attr(marker, name);
      if (["0", "false", "off"].includes(value))
        marker.removeAttributeNS(W, name);
      else if (["1", "true", "on"].includes(value))
        marker.setAttributeNS(W, `w:${name}`, "1");
    }
  }
  const singleton = new Set([
    "rPr",
    "alias",
    "lock",
    "placeholder",
    "showingPlcHdr",
    "dataBinding",
    "temporary",
    "id",
    "tag",
    "equation",
    "comboBox",
    "date",
    "docPartObj",
    "docPartList",
    "dropDownList",
    "picture",
    "richText",
    "text",
    "citation",
    "group",
    "bibliography",
  ]);
  for (const properties of all(doc, "sdtPr")) {
    const children = Array.from(properties.children);
    const names = children.map((e) => `${e.namespaceURI}:${e.localName}`);
    if (
      new Set(names).size !== names.length ||
      children.some(
        (e) =>
          !(e.namespaceURI === W && singleton.has(e.localName)) &&
          !(
            e.namespaceURI === W15 &&
            ["appearance", "color"].includes(e.localName)
          ),
      )
    )
      continue;
    properties.replaceChildren(
      ...children.sort((a, b) =>
        `${a.namespaceURI}:${a.localName}`.localeCompare(
          `${b.namespaceURI}:${b.localName}`,
        ),
      ),
    );
  }
}

interface FieldSpan {
  element?: Element;
  start?: Element;
  end?: Element;
  separator?: Element;
  instruction: string;
  result: string;
}
function fields(root: Element): FieldSpan[] {
  const spans: FieldSpan[] = [],
    stack: FieldSpan[] = [];
  for (const node of [root, ...Array.from(root.getElementsByTagName("*"))]) {
    if (node.namespaceURI !== W || !isWordMediaElementActive(node)) continue;
    if (node.localName === "fldSimple")
      spans.push({
        element: node,
        instruction: attr(node, "instr"),
        result: contentText(node),
      });
    if (node.localName === "fldChar") {
      const type = attr(node, "fldCharType");
      if (type === "begin") {
        const span: FieldSpan = { start: node, instruction: "", result: "" };
        stack.push(span);
        spans.push(span);
      } else if (type === "separate") {
        if (stack.at(-1)) stack.at(-1)!.separator = node;
      } else if (type === "end") {
        const span = stack.pop();
        if (span) span.end = node;
      }
    } else if (node.localName === "instrText") {
      if (stack.at(-1) && !stack.at(-1)!.separator)
        stack.at(-1)!.instruction += node.textContent ?? "";
    } else if (node.localName === "t")
      for (const span of stack)
        if (span.separator) span.result += node.textContent ?? "";
  }
  return spans;
}
function lockValue(
  properties: Element | undefined,
): WordContentControlSpec["lock"] {
  return properties
    ? ((
        {
          contentLocked: "content",
          sdtLocked: "control",
          sdtContentLocked: "both",
        } as const
      )[attr(child(properties, "lock")) as "contentLocked"] ?? "none")
    : "none";
}
export function inventoryWordNativeStructures(
  root: Element,
): WordNativeStructureObject[] {
  return [
    ...fields(root).map((f, i) => ({
      kind: "field" as const,
      target: `field-${i + 1}`,
      instruction: f.instruction,
      text: f.result,
    })),
    ...all(root, "bookmarkStart").map((b, i) => ({
      kind: "bookmark" as const,
      target: `bookmark-${i + 1}`,
      id: attr(b, "id"),
      name: attr(b, "name"),
    })),
    ...(root.namespaceURI === W && root.localName === "sdt"
      ? [root, ...all(root, "sdt")]
      : all(root, "sdt")
    ).map((c, i) => {
      const p = child(c, "sdtPr");
      return {
        kind: "content-control" as const,
        target: `control-${i + 1}`,
        id: p ? attr(child(p, "id")) : "",
        title: p ? attr(child(p, "alias")) : "",
        tag: p ? attr(child(p, "tag")) : "",
        lock: lockValue(p),
        bound: p ? !!child(p, "dataBinding") : false,
        text: contentText(c),
      };
    }),
  ];
}

function rangeBetween(doc: Document, start: Element, end: Element) {
  const range = doc.createRange();
  range.setStartAfter(start);
  range.setEndBefore(end);
  return range;
}
function fieldMutation(
  doc: Document,
  span: FieldSpan,
  edit: Extract<WordNativeStructureEdit, { kind: "field" }>,
) {
  if (span.element) {
    if (edit.operation === "delete") span.element.remove();
    else if (edit.operation === "unwrap")
      span.element.replaceWith(...Array.from(span.element.childNodes));
    else {
      if (edit.instruction !== undefined)
        span.element.setAttributeNS(W, "w:instr", edit.instruction);
      if (edit.text !== undefined)
        span.element.replaceChildren(run(doc, edit.text));
      if (edit.locked !== undefined)
        span.element.setAttributeNS(W, "w:fldLock", edit.locked ? "1" : "0");
    }
    return;
  }
  if (!span.start || !span.end) throw new Error("Incomplete native field");
  // A field boundary is a run child. Ranges leave surrounding runs/paragraphs intact.
  if (edit.operation === "update") {
    if (edit.instruction !== undefined) {
      const instructionRange = rangeBetween(
        doc,
        span.start,
        span.separator ?? span.end,
      );
      instructionRange.deleteContents();
      const code = make(doc, "instrText");
      code.setAttributeNS(XML, "xml:space", "preserve");
      code.textContent = ` ${edit.instruction} `;
      span.start.parentElement!.insertBefore(code, span.start.nextSibling);
    }
    if (edit.text !== undefined) {
      if (!span.separator) {
        const separator = make(doc, "fldChar");
        separator.setAttributeNS(W, "w:fldCharType", "separate");
        span.end.parentElement!.insertBefore(separator, span.end);
        span.separator = separator;
      }
      const resultRange = rangeBetween(doc, span.separator, span.end);
      resultRange.deleteContents();
      const result = make(doc, "t");
      result.setAttributeNS(XML, "xml:space", "preserve");
      result.textContent = edit.text;
      span.separator.parentElement!.insertBefore(
        result,
        span.separator.nextSibling,
      );
    }
    if (edit.locked !== undefined)
      span.start.setAttributeNS(W, "w:fldLock", edit.locked ? "1" : "0");
  } else if (edit.operation === "unwrap") {
    const instructionRange = rangeBetween(
      doc,
      span.start,
      span.separator ?? span.end,
    );
    instructionRange.deleteContents();
    span.separator?.remove();
    span.start.remove();
    span.end.remove();
  } else {
    const range = rangeBetween(doc, span.start, span.end);
    range.deleteContents();
    span.start.remove();
    span.end.remove();
  }
}

/** Targets are resolved before edits: removing one object never renumbers another. */
export function applyWordNativeStructures<T>(
  doc: Document,
  fragment: Element,
  edits: WordNativeStructureEdit<T>[],
  options: WordNativeStructureOptions<T>,
): Element {
  const emptyRun = (node: Element) =>
    Array.from(node.children).every(
      (e) => e.namespaceURI === W && e.localName === "rPr",
    );
  const originalEmptyRuns = new Set(all(fragment, "r").filter(emptyRun));
  const nativeFields = fields(fragment);
  const bookmarks = all(fragment, "bookmarkStart");
  const controls =
    fragment.namespaceURI === W && fragment.localName === "sdt"
      ? [fragment, ...all(fragment, "sdt")]
      : all(fragment, "sdt");
  const media = inventoryWordMedia(fragment, "source");
  const mediaElements = [...all(fragment, "drawing"), ...all(fragment, "pict")];
  const targets = new Set<string>();
  for (const edit of edits) {
    if (targets.has(edit.target))
      throw new Error("Duplicate native edit target");
    targets.add(edit.target);
    const index =
      Number(edit.target.slice(edit.target.lastIndexOf("-") + 1)) - 1;
    if (edit.kind === "field") {
      const target = nativeFields[index];
      if (!target) throw new Error("Unknown field target");
      if (!fragment.contains(target.element ?? target.start!))
        throw new Error("Overlapping native edit targets");
      fieldMutation(doc, target, edit);
    } else if (edit.kind === "bookmark") {
      const start = bookmarks[index],
        end = start
          ? all(fragment, "bookmarkEnd").find(
              (b) => attr(b, "id") === attr(start, "id"),
            )
          : undefined;
      if (!start || !end)
        throw new Error("Unknown or incomplete bookmark target");
      if (!fragment.contains(start) || !fragment.contains(end))
        throw new Error("Overlapping native edit targets");
      if (edit.operation === "delete" || edit.text !== undefined) {
        const range = rangeBetween(doc, start, end);
        range.deleteContents();
        if (edit.text !== undefined) {
          const replacement = run(doc, edit.text);
          if (start.parentElement?.localName === "p")
            start.parentElement.insertBefore(replacement, start.nextSibling);
          else throw new Error("Bookmark text requires a paragraph anchor");
        }
      }
      if (edit.operation !== "update") {
        start.remove();
        end.remove();
      } else if (edit.name !== undefined) {
        if (
          all(doc, "bookmarkStart").some(
            (b) => b !== start && attr(b, "name") === edit.name,
          )
        )
          throw new Error("Duplicate bookmark name");
        start.setAttributeNS(W, "w:name", edit.name);
      }
    } else if (edit.kind === "content-control") {
      const target = controls[index];
      if (!target) throw new Error("Unknown content control target");
      if (!fragment.contains(target))
        throw new Error("Overlapping native edit targets");
      const contents = child(target, "sdtContent");
      if (!contents) throw new Error("Content control has no content");
      if (edit.operation === "delete") {
        if (target === fragment) {
          fragment = make(doc, "body");
        } else target.remove();
      } else if (edit.operation === "unwrap") {
        if (target === fragment) {
          const wrapper = make(doc, "body");
          wrapper.append(...Array.from(contents.childNodes));
          fragment = wrapper;
        } else target.replaceWith(...Array.from(contents.childNodes));
      } else {
        let properties = child(target, "sdtPr");
        if (!properties) {
          properties = make(doc, "sdtPr");
          target.insertBefore(properties, target.firstChild);
        }
        controlProperties(doc, properties, edit);
        if (edit.children !== undefined) {
          // Authoring supplied content becomes authoritative; stale bindings would overwrite it.
          if (edit.binding !== "retain")
            child(properties, "dataBinding")?.remove();
          for (const kind of [
            "text",
            "picture",
            "date",
            "dropDownList",
            "comboBox",
            "checkbox",
            "repeatingSection",
            "repeatingSectionItem",
          ]) {
            for (const p of Array.from(properties.children))
              if (p.localName === kind) p.remove();
          }
          const blocks = options.compileBlocks(edit.children);
          if (
            target.parentElement?.namespaceURI === W &&
            target.parentElement.localName === "p"
          ) {
            if (blocks.some((b) => b.namespaceURI !== W || b.localName !== "p"))
              throw new Error(
                "Inline content controls require paragraph content",
              );
            contents.replaceChildren(
              ...blocks.flatMap((b, i) => [
                ...(i ? [run(doc, "\n")] : []),
                ...Array.from(b.children).filter((e) => e.localName !== "pPr"),
              ]),
            );
          } else if (
            ["tr", "tc"].includes(contents.firstElementChild?.localName ?? "")
          ) {
            const expected = contents.firstElementChild!.localName;
            if (
              blocks.length !== 1 ||
              blocks[0].namespaceURI !== W ||
              blocks[0].localName !== "tbl"
            )
              throw new Error(
                "Table controls require one table as replacement content",
              );
            const rows = Array.from(blocks[0].children).filter(
              (e) => e.namespaceURI === W && e.localName === "tr",
            );
            if (expected === "tc" && rows.length !== 1)
              throw new Error("Cell controls require a single table row");
            contents.replaceChildren(
              ...(expected === "tr"
                ? rows
                : Array.from(rows[0]?.children ?? []).filter(
                    (e) => e.namespaceURI === W && e.localName === "tc",
                  )),
            );
          } else
            contents.replaceChildren(
              ...(blocks.length ? blocks : [make(doc, "p")]),
            );
        }
        if (edit.binding === "remove")
          child(properties, "dataBinding")?.remove();
      }
    } else {
      const descriptor = media.find((m) => m.target === edit.target),
        target = descriptor
          ? mediaElements[media.indexOf(descriptor)]
          : undefined;
      if (!target) throw new Error("Unknown media target");
      if (!fragment.contains(target))
        throw new Error("Overlapping native edit targets");
      if (edit.operation === "delete")
        wordMediaMutationContainer(target).remove();
      else {
        const spec = edit.kind === "image" ? edit.image! : edit.drawing!;
        const selected = spec.sourceRef
          ? options.resolveMediaSource?.(spec.sourceRef)
          : undefined;
        if (spec.sourceRef && !selected)
          throw new Error("Unknown replacement media source");
        const sourceXml = new XMLSerializer().serializeToString(target);
        const source = {
          ...options,
          sourceXml,
          preserveIds: !selected,
          ...selected,
        };
        const effective = {
          ...spec,
          sourceRef: spec.sourceRef ?? "source",
          sourceIndex: selected?.sourceIndex ?? 0,
        };
        const paragraph =
          edit.kind === "image"
            ? compileWordImage(doc, effective, source)
            : compileWordDrawing(doc, effective, source);
        const replacement =
          all(paragraph, "drawing")[0] ?? all(paragraph, "pict")[0];
        if (!replacement) throw new Error("No replacement media");
        if (spec.alignment !== undefined) {
          let owner = target.parentElement;
          while (
            owner &&
            !(owner.namespaceURI === W && owner.localName === "p")
          )
            owner = owner.parentElement;
          if (owner) {
            let properties = child(owner, "pPr");
            if (!properties) {
              properties = make(doc, "pPr");
              owner.prepend(properties);
            }
            child(properties, "jc")?.remove();
            properties.append(make(doc, "jc", spec.alignment));
          }
        }
        wordMediaMutationContainer(target).replaceWith(replacement);
      }
    }
  }
  for (const node of all(fragment, "r")) {
    if (emptyRun(node) && !originalEmptyRuns.has(node)) node.remove();
  }
  return fragment;
}
